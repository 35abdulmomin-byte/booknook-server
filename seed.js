import "dotenv/config";
import { MongoClient } from "mongodb";

// ব্যবহার: node seed.js "Your Name" "your@email.com"
const [name, email] = process.argv.slice(2);
if (!name || !email) {
  console.log('Usage: node seed.js "Your Name" "your@email.com"');
  process.exit(1);
}

// ?default=false: ছবি না থাকলে ফাঁকা ছবির বদলে এরর আসবে, তাই ফ্রন্টএন্ডের ফলব্যাক কার্ড কাজ করবে
const cover = (isbn) =>
  `https://covers.openlibrary.org/b/isbn/${isbn}-L.jpg?default=false`;

const books = [
  { title: "A Brief History of Time", author: "Stephen Hawking", category: "Science", isbn: "9780553380163", copies: 3, description: "A clear and friendly tour of black holes, the Big Bang and the nature of time, written for readers without a physics background." },
  { title: "Sapiens", author: "Yuval Noah Harari", category: "History", isbn: "9780062316110", copies: 4, description: "The story of how humans went from a small group of apes to the rulers of the planet, told across seventy thousand years." },
  { title: "The Little Prince", author: "Antoine de Saint-Exupéry", category: "Kids", isbn: "9780156012195", copies: 5, description: "A pilot stranded in the desert meets a small prince from another planet in this gentle tale about friendship and what really matters." },
  { title: "Charlotte's Web", author: "E. B. White", category: "Kids", isbn: "9780064400558", copies: 4, description: "A young pig named Wilbur and a clever spider named Charlotte prove that true friends can change your fate." },
  { title: "Atomic Habits", author: "James Clear", category: "Others", isbn: "9780735211292", copies: 5, description: "Small daily changes add up to remarkable results. A practical guide to building good habits and breaking bad ones." },
  { title: "The Name of the Wind", author: "Patrick Rothfuss", category: "Fiction", isbn: "9780756404741", copies: 3, description: "A gifted young man grows from a street orphan into the most notorious wizard his world has ever seen." },
  { title: "The Hitchhiker's Guide to the Galaxy", author: "Douglas Adams", category: "Fiction", isbn: "9780345391803", copies: 4, description: "Moments before Earth is demolished, Arthur Dent is whisked into space on a funny and wildly imaginative journey." },
  { title: "The Martian", author: "Andy Weir", category: "Fiction", isbn: "9780553418026", copies: 3, description: "Stranded alone on Mars, astronaut Mark Watney must use his science skills and humor to survive until rescue." },
  { title: "Project Hail Mary", author: "Andy Weir", category: "Fiction", isbn: "9780593135204", copies: 4, description: "A lone astronaut wakes up on a spaceship with no memory and discovers he is humanity's last hope." },
  { title: "Dune", author: "Frank Herbert", category: "Fiction", isbn: "9780441013593", copies: 3, description: "On the desert planet Arrakis, young Paul Atreides is pulled into a struggle over the most valuable substance in the universe." },
  { title: "The Great Gatsby", author: "F. Scott Fitzgerald", category: "Fiction", isbn: "9780743273565", copies: 4, description: "A story of love, wealth and illusion in the Jazz Age, told through the eyes of Nick Carraway." },
  { title: "To Kill a Mockingbird", author: "Harper Lee", category: "Fiction", isbn: "9780061120084", copies: 5, description: "Through the eyes of young Scout Finch, a small Southern town confronts prejudice and the meaning of courage." },
];

const client = new MongoClient(process.env.MONGODB_URI);

try {
  await client.connect();
  const col = client.db("booknook").collection("books");
  const now = Date.now();
  let added = 0;

  for (let i = 0; i < books.length; i++) {
    const b = books[i];
    const exists = await col.findOne({ title: b.title, "addedBy.email": email });

    if (exists) {
      // আগে ঢোকানো বইয়ের ছবির লিংক নতুন করে ঠিক করে দেয়
      await col.updateOne({ _id: exists._id }, { $set: { image: cover(b.isbn) } });
      console.log(`Updated image: ${b.title}`);
      continue;
    }

    await col.insertOne({
      title: b.title,
      author: b.author,
      category: b.category,
      image: cover(b.isbn),
      description: b.description,
      totalCopies: b.copies,
      availableCopies: b.copies,
      addedBy: { name, email },
      // তালিকার শেষের বইগুলো সবচেয়ে নতুন হবে, তাই Home-এ ওগুলোই আগে দেখাবে
      createdAt: new Date(now - (books.length - i) * 60 * 1000),
    });
    added++;
  }

  console.log(`Done. ${added} book(s) added.`);
} catch (err) {
  console.error("Seed failed:", err.message);
} finally {
  await client.close();
}