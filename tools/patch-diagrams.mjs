/**
 * 把 index.html 里的裁片图和拼接图替换成更详细的版本。
 * 只做字符串定位 + 整块替换，运行一次即可。
 */
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const file = join(here, "..", "index.html");
let html = readFileSync(file, "utf8");

function replaceSvg(id, next) {
  const start = html.indexOf(`<svg id="${id}"`);
  if (start < 0) throw new Error(`找不到 #${id}`);
  const end = html.indexOf("</svg>", start);
  if (end < 0) throw new Error(`#${id} 没有闭合`);
  html = html.slice(0, start) + next + html.slice(end + "</svg>".length);
}

const pieces = readFileSync(join(here, "piecesArt.svg"), "utf8").trim();
const assembly = readFileSync(join(here, "assemblyArt.svg"), "utf8").trim();

replaceSvg("piecesArt", pieces);
replaceSvg("assemblyArt", assembly);

writeFileSync(file, html, "utf8");
console.log("已替换：piecesArt、assemblyArt");
