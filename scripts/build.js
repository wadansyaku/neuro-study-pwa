import { promises as fs } from "fs";
import path from "path";

const root = process.cwd();
const distDir = path.join(root, "dist");

const filesToCopy = [
  "index.html",
  "app.js",
  "style.css",
  "manifest.webmanifest",
  "sw.js",
  "_headers"
];
const dirsToCopy = ["data", "icons"];

async function copyFileIfExists(src, dest) {
  try {
    await fs.copyFile(src, dest);
  } catch (err) {
    if (err.code !== "ENOENT") throw err;
  }
}

async function copyDirIfExists(src, dest) {
  try {
    await fs.cp(src, dest, { recursive: true });
  } catch (err) {
    if (err.code !== "ENOENT") throw err;
  }
}

async function main() {
  await fs.rm(distDir, { recursive: true, force: true });
  await fs.mkdir(distDir, { recursive: true });

  await Promise.all(
    filesToCopy.map((file) =>
      copyFileIfExists(path.join(root, file), path.join(distDir, file))
    )
  );

  await Promise.all(
    dirsToCopy.map((dir) =>
      copyDirIfExists(path.join(root, dir), path.join(distDir, dir))
    )
  );

  console.log("dist build complete");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
