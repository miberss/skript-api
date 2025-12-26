import index from "./index.html"
const port = process.env.PORT || 3000;

process.on("uncaughtException", (err) => {
  console.error("UNCAUGHT EXCEPTION:", err);
});

process.on("unhandledRejection", (reason) => {
  console.error("UNHANDLED REJECTION:", reason);
});

const server = Bun.serve({
  port: port,
  routes: {
    "/": index
  }
});

console.log(`Server running on port ${port}`);