import "dotenv/config";
import dns from "node:dns";
import express from "express";
import cors from "cors";
import { MongoClient, ObjectId } from "mongodb";
import { createRemoteJWKSet, jwtVerify } from "jose";

dns.setServers(["8.8.8.8", "1.1.1.1"]);

const app = express();
const port = process.env.PORT || 5000;
const AUTH_URL = process.env.AUTH_URL;
const CATEGORIES = ["Fiction", "Science", "History", "Kids", "Others"];

app.use(
  cors({ origin: (process.env.CLIENT_URL || "http://localhost:3000").split(",") })
);
app.use(express.json());


const client = new MongoClient(process.env.MONGODB_URI);
await client.connect();
const db = client.db("booknook");
const booksCol = db.collection("books");
const borrowsCol = db.collection("borrows");


await borrowsCol.createIndex({ userEmail: 1, bookId: 1 }, { unique: true });
console.log("MongoDB connected");


const JWKS = createRemoteJWKSet(new URL(`${AUTH_URL}/api/auth/jwks`));

async function verifyToken(req, res, next) {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) {
    return res.status(401).send({ message: "Unauthorized: token missing." });
  }
  try {
    const { payload } = await jwtVerify(header.split(" ")[1], JWKS, {
      issuer: AUTH_URL,
      audience: AUTH_URL,
    });
    req.user = { id: payload.id ?? payload.sub, name: payload.name, email: payload.email };
    next();
  } catch {
    res.status(401).send({ message: "Unauthorized: invalid or expired token." });
  }
}


const isValidId = (id) => /^[a-f\d]{24}$/i.test(String(id));
const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// ---------- BOOKS ----------
// 1. GET /books (public) : ?limit=6 &category=Fiction &search=text &email=user@mail.com
app.get("/books", async (req, res) => {
  const { limit, category, search, email } = req.query;
  const filter = {};

  if (category && CATEGORIES.includes(String(category))) filter.category = String(category);
  if (email) filter["addedBy.email"] = String(email);
  if (search) {
    const regex = { $regex: escapeRegex(String(search)), $options: "i" };
    filter.$or = [{ title: regex }, { author: regex }];
  }

  const cursor = booksCol.find(filter).sort({ createdAt: -1 }); // newest first
  const n = parseInt(String(limit));
  if (n > 0) cursor.limit(n);

  res.send(await cursor.toArray());
});

// 2. GET /books/:id
app.get("/books/:id", async (req, res) => {
  const { id } = req.params;
  if (!isValidId(id)) return res.status(400).send({ message: "Invalid book id." });

  const book = await booksCol.findOne({ _id: new ObjectId(id) });
  if (!book) return res.status(404).send({ message: "Book not found." });
  res.send(book);
});

// 3. POST /books(protected)
app.post("/books", verifyToken, async (req, res) => {
  const { title, author, category, image, description, totalCopies } = req.body;
  const copies = Number(totalCopies);

  if (
    !title?.trim() || !author?.trim() || !description?.trim() || !image ||
    !CATEGORIES.includes(category) || !Number.isInteger(copies) || copies < 1
  ) {
    return res.status(400).send({ message: "Please provide valid book information." });
  }

  const book = {
    title: title.trim(),
    author: author.trim(),
    category,
    image,
    description: description.trim(),
    totalCopies: copies,
    availableCopies: copies,
    addedBy: { name: req.user.name, email: req.user.email }, // token theke, frontend theke noy
    createdAt: new Date(),
  };

  const result = await booksCol.insertOne(book);
  res.status(201).send({ ...book, _id: result.insertedId });
});

// 4. PATCH /books/:id (protected, shudhu owner)
app.patch("/books/:id", verifyToken, async (req, res) => {
  const { id } = req.params;
  if (!isValidId(id)) return res.status(400).send({ message: "Invalid book id." });

  const book = await booksCol.findOne({ _id: new ObjectId(id) });
  if (!book) return res.status(404).send({ message: "Book not found." });
  if (book.addedBy.email !== req.user.email) {
    return res.status(403).send({ message: "You can only edit your own books." });
  }

  const { title, author, category, image, description, totalCopies } = req.body;
  const update = {};

  if (title?.trim()) update.title = title.trim();
  if (author?.trim()) update.author = author.trim();
  if (description?.trim()) update.description = description.trim();
  if (image) update.image = image;
  if (category !== undefined) {
    if (!CATEGORIES.includes(category)) {
      return res.status(400).send({ message: "Invalid category." });
    }
    update.category = category;
  }
  if (totalCopies !== undefined) {
    const copies = Number(totalCopies);
    if (!Number.isInteger(copies) || copies < 1) {
      return res.status(400).send({ message: "Total copies must be 1 or more." });
    }
    update.totalCopies = copies;
    update.availableCopies = Math.max(0, book.availableCopies + (copies - book.totalCopies));
  }

  const updated = await booksCol.findOneAndUpdate(
    { _id: book._id },
    { $set: update },
    { returnDocument: "after" }
  );
  res.send(updated);
});

// 5. DELETE /books/:id (protected, shudhu owner)
app.delete("/books/:id", verifyToken, async (req, res) => {
  const { id } = req.params;
  if (!isValidId(id)) return res.status(400).send({ message: "Invalid book id." });

  const book = await booksCol.findOne({ _id: new ObjectId(id) });
  if (!book) return res.status(404).send({ message: "Book not found." });
  if (book.addedBy.email !== req.user.email) {
    return res.status(403).send({ message: "You can only delete your own books." });
  }

  await booksCol.deleteOne({ _id: book._id });
  await borrowsCol.deleteMany({ bookId: book._id }); // oi boi-er borrow record-o muche jabe
  res.send({ message: "Book deleted successfully." });
});

// ---------- BORROWS ----------
// 6. POST /borrows (protected)
app.post("/borrows", verifyToken, async (req, res) => {
  const { bookId } = req.body;
  if (!isValidId(bookId)) return res.status(400).send({ message: "Invalid book id." });

  const book = await booksCol.findOne({ _id: new ObjectId(bookId) });
  if (!book) return res.status(404).send({ message: "Book not found." });
  if (book.availableCopies < 1) {
    return res.status(400).send({ message: "This book is not available right now." });
  }

  const borrowDate = new Date();
  const returnDate = new Date(borrowDate.getTime() + 7 * 24 * 60 * 60 * 1000); // 7 din pore

  const borrow = {
    bookId: book._id,
    bookTitle: book.title,
    bookImage: book.image,
    userName: req.user.name,
    userEmail: req.user.email,
    borrowDate,
    returnDate,
  };

  // age borrow save: duplicate hole unique index error dibe (No Double Borrow)
  try {
    const result = await borrowsCol.insertOne(borrow);
    borrow._id = result.insertedId;
  } catch (err) {
    if (err.code === 11000) {
      return res.status(409).send({ message: "You have already borrowed this book." });
    }
    throw err;
  }

  // tarpor copy 1 kom ($inc), copy 0 hole condition fail korbe
  const updated = await booksCol.findOneAndUpdate(
    { _id: book._id, availableCopies: { $gt: 0 } },
    { $inc: { availableCopies: -1 } }
  );
  if (!updated) {
    await borrowsCol.deleteOne({ _id: borrow._id });
    return res.status(400).send({ message: "This book is not available right now." });
  }

  res.status(201).send(borrow);
});

// 7. GET /borrows (protected, nijer borrow gulo)
app.get("/borrows", verifyToken, async (req, res) => {
  const list = await borrowsCol
    .find({ userEmail: req.user.email })
    .sort({ borrowDate: -1 })
    .toArray();
  res.send(list);
});

// 8. DELETE /borrows/:id (protected, return book)
app.delete("/borrows/:id", verifyToken, async (req, res) => {
  const { id } = req.params;
  if (!isValidId(id)) return res.status(400).send({ message: "Invalid borrow id." });

  const borrow = await borrowsCol.findOne({ _id: new ObjectId(id) });
  if (!borrow) return res.status(404).send({ message: "Borrow record not found." });
  if (borrow.userEmail !== req.user.email) {
    return res.status(403).send({ message: "This is not your borrow." });
  }

  await borrowsCol.deleteOne({ _id: borrow._id });
  await booksCol.updateOne({ _id: borrow.bookId }, { $inc: { availableCopies: 1 } });
  res.send({ message: "Book returned successfully." });
});

// ---------- misc ----------
app.get("/", (req, res) => res.send("BookNook server is running"));

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).send({ message: "Internal server error." });
});

app.listen(port, () => console.log(`Server running on port ${port}`));