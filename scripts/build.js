import { promises as fs } from "fs";
import path from "path";

const root = process.cwd();
const distDir = path.join(root, "dist");
const outDir = path.join(root, "out");

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

async function countFiles(dir) {
  let count = 0;
  const entries = await fs.readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const entryPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      count += await countFiles(entryPath);
    } else {
      count += 1;
    }
  }
  return count;
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

  await fs.rm(outDir, { recursive: true, force: true });
  await fs.mkdir(outDir, { recursive: true });
  await fs.cp(distDir, outDir, { recursive: true });
  console.log("out sync complete");

  const outIndexPath = path.join(outDir, "index.html");
  try {
    await fs.access(outIndexPath);
  } catch (err) {
    if (err.code === "ENOENT") {
      throw new Error("out/index.html not found after build");
    }
    throw err;
  }

  const outFileCount = await countFiles(outDir);
  console.log(`out path: ${outDir}`);
  console.log(`out files: ${outFileCount}`);
  console.log("out/index.html exists: true");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
