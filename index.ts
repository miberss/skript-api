import index from "./index.html"
const port = process.env.PORT || 3000;

const server = Bun.serve({
  port: port,
  routes: {
    "/": index
  }
});

console.log(`Server running on port ${port}`);