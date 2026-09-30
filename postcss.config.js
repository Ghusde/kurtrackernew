// Tailwind was never used: src/styles.css is 848 lines of hand-written CSS with
// its own class names and no @tailwind/@apply directives. Only autoprefixer
// does real work here.
export default {
  plugins: {
    autoprefixer: {}
  }
};
