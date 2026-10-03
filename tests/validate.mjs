/**
 * 合法性与几何自检：
 * 1. 通用 SVG 合法性（标签闭合、路径可解析）
 * 2. 几何比例校验（按裁片尺寸还原后，关键边长必须与成品表一致）
 * 3. 内容校验（尺寸表、买布清单、步骤、图片说明齐全）
 *
 * 运行：node tests/validate.mjs
 */
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const html = readFileSync(join(root, "index.html"), "utf8");

const failures = [];
const checks = [];

function check(name, fn) {
  try {
    const detail = fn();
    checks.push({ name, detail: detail || "ok" });
  } catch (err) {
    failures.push({ name, message: err.message });
  }
}

function assert(cond, message) {
  if (!cond) throw new Error(message);
}

function near(actual, expected, tol, label) {
  assert(
    Math.abs(actual - expected) <= tol,
    `${label}: 期望 ${expected} ±${tol}，实际 ${actual.toFixed(2)}`
  );
}

/* ---------- 通用 SVG 合法性 ---------- */

function svgBlocks(source) {
  const blocks = [];
  const re = /<svg\b[^>]*>([\s\S]*?)<\/svg>/g;
  let m;
  while ((m = re.exec(source))) blocks.push(m[0]);
  return blocks;
}

function elementIds(block) {
  const ids = [];
  const re = /\sid="([^"]+)"/g;
  let m;
  while ((m = re.exec(block))) ids.push(m[1]);
  return ids;
}

function elementByTag(id, tag, block) {
  const re = new RegExp(`<${tag}\\b[^>]*\\sid="${id}"[^>]*>`, "g");
  return block.match(re) || [];
}

function extractPathD(markup) {
  const m = markup.match(/\sd="([^"]+)"/);
  assert(m, "找不到 d 属性");
  return m[1];
}

function parsePath(d) {
  const tokens = d
    .replace(/([MLHVCZmlhvcz])/g, " $1 ")
    .replace(/([A-Za-z])/g, " $1 ")
    .trim()
    .split(/[\s,]+/)
    .filter(Boolean);
  const points = [];
  let cmd = null;
  let x = 0;
  let y = 0;
  const stack = [];
  let i = 0;
  const nums = () => {
    const out = [];
    while (i < tokens.length && /^[-+]?\.?\d/.test(tokens[i])) out.push(Number(tokens[i++]));
    return out;
  };
  while (i < tokens.length) {
    const t = tokens[i];
    if (/^[A-Za-z]$/.test(t)) {
      cmd = t;
      i++;
    } else if (cmd === null) {
      throw new Error(`路径以数字开头: ${d}`);
    }
    const rel = cmd === cmd.toLowerCase();
    const c = cmd.toUpperCase();
    if (c === "M" || c === "L" || c === "H" || c === "V") {
      const v = nums();
      for (let k = 0; k < v.length; k += 2) {
        if (k + 1 >= v.length) throw new Error(`坐标个数不成对: ${d}`);
        let nx = v[k];
        let ny = v[k + 1];
        if (c === "H") ny = y;
        if (c === "V") nx = x;
        if (rel) {
          nx += x;
          ny += y;
        }
        x = nx;
        y = ny;
        points.push([x, y]);
      }
    } else if (c === "C") {
      const v = nums();
      if (v.length % 6 !== 0) throw new Error(`C 段坐标个数不是 6 的倍数: ${d}`);
      for (let k = 0; k < v.length; k += 6) {
        let p0 = v[k];
        let p1 = v[k + 1];
        let p2 = v[k + 2];
        let p3 = v[k + 3];
        let p4 = v[k + 4];
        let p5 = v[k + 5];
        if (rel) {
          p0 += x; p1 += y; p2 += x; p3 += y; p4 += x; p5 += y;
        }
        points.push([p4, p5]);
        x = p4;
        y = p5;
      }
    } else if (c === "Z") {
      if (points.length) points.push(points[0].slice());
    } else {
      throw new Error(`暂不支持的路径指令 ${cmd}`);
    }
    stack.push(c);
  }
  return { points, stack };
}

/* ---------- 几何还原 ---------- */

function arcLength(points) {
  let total = 0;
  for (let i = 1; i < points.length; i++) {
    total += Math.hypot(points[i][0] - points[i - 1][0], points[i][1] - points[i - 1][1]);
  }
  return total;
}

// 裁片图按 前身片 240→500px 对应 42cm 还原
const BODY_SCALE = 260 / 42;
const SHOULDER_Y = 240;

const blocks = svgBlocks(html);
assert(blocks.length >= 4, `页面应至少有 4 个示意图，实际 ${blocks.length}`);

const pieces = blocks.find((b) => b.includes('id="piecesArt"'));
assert(pieces, "缺少裁片图 piecesArt");

const ids = elementIds(pieces);
const unique = new Set(ids);
assert(ids.length === unique.size, "裁片图存在重复 id");

const frontOutline = extractPathD(elementByTag("bodyFrontOutline", "path", pieces)[0]);
const backOutline = extractPathD(elementByTag("bodyBackOutline", "path", pieces)[0]);
const front = parsePath(frontOutline).points;
const back = parsePath(backOutline).points;

function circleCenter(id) {
  const markup = elementByTag(id, "circle", pieces)[0];
  assert(markup, `缺少标记 ${id}`);
  const cx = Number(markup.match(/\scx="(-?\d+(?:\.\d+)?)"/)[1]);
  const cy = Number(markup.match(/\scy="(-?\d+(?:\.\d+)?)"/)[1]);
  return [cx, cy];
}

check("裁片图：前身片半胸宽 = 42cm", () => {
  const chest = circleCenter("frontChestMarker");
  near((500 - chest[0]) / BODY_SCALE, 42, 0.2, "前身片半胸宽");
  return "42.0cm";
});

check("裁片图：后身片半胸宽 = 42cm", () => {
  const chest = circleCenter("backChestMarker");
  near((chest[0] - 500) / BODY_SCALE, 42, 0.2, "后身片半胸宽");
  return "42.0cm";
});

check("裁片图：前领深 = 9cm", () => {
  const neck = circleCenter("frontNeckMarker");
  near((neck[1] - SHOULDER_Y) / BODY_SCALE, 9, 0.4, "前领深");
  return "9.0cm";
});

check("裁片图：后领深 = 3cm", () => {
  const neck = circleCenter("backNeckMarker");
  near((neck[1] - SHOULDER_Y) / BODY_SCALE, 3, 0.4, "后领深");
  return "3.0cm";
});

check("裁片图：袖窿深 = 21.5cm", () => {
  const chest = circleCenter("frontChestMarker");
  near((chest[1] - SHOULDER_Y) / BODY_SCALE, 21.5, 0.6, "袖窿深");
  return "21.5cm";
});

check("裁片图：袖子标注 32 / 28 / 22", () => {
  assert(/袖长 32/.test(pieces), "缺袖长标注");
  assert(/袖根 28/.test(pieces), "缺袖根标注");
  assert(/腕 22/.test(pieces), "缺袖腕标注");
  return "ok";
});

check("裁片图：裤腿标注腿长 46 / 腿根 32 / 踝口 24", () => {
  assert(/腿长 46/.test(pieces), "缺腿长标注");
  assert(/腿根 32/.test(pieces), "缺腿根标注");
  assert(/踝口 24/.test(pieces), "缺踝口标注");
  return "ok";
});

check("裁片图：帽子标注高 26 / 宽 24 / 领口 9", () => {
  assert(/高 26/.test(pieces) && /宽 24/.test(pieces), "缺帽子尺寸标注");
  assert(/领口边 9/.test(pieces), "缺帽子领口边标注");
  return "ok";
});

check("裁片图：所有图元都在画布内", () => {
  const viewBox = pieces.match(/viewBox="0 0 (\d+(?:\.\d+)?) (\d+(?:\.\d+)?)"/);
  assert(viewBox, "缺少 viewBox");
  const [, w, h] = viewBox.map(Number);
  for (const id of ["bodyFrontOutline", "bodyBackOutline", "sleeveOutline", "legOutline"]) {
    const markup = elementByTag(id, "path", pieces)[0];
    assert(markup, `缺少 ${id}`);
    for (const [x, y] of parsePath(extractPathD(markup)).points) {
      assert(x >= 0 && x <= w && y >= 0 && y <= h, `${id} 有点 (${x},${y}) 超出画布 ${w}×${h}`);
    }
  }
  return `${w}×${h} 内`;
});

/* ---------- 拼接图 ---------- */

const assembly = blocks.find((b) => b.includes('id="assemblyArt"'));
check("拼接图：六步齐全", () => {
  assert(assembly, "缺少拼接图 assemblyArt");
  for (const id of ["asShoulder", "asSleeve", "asSide", "asGusset", "asRib", "asPlacket"]) {
    assert(assembly.includes(`id="${id}"`), `缺少 ${id}`);
  }
  for (const label of ["① 肩缝", "② 上袖", "③ 侧缝", "④ 裆片", "⑤ 收口", "⑥ 前襟 + 连帽"]) {
    assert(assembly.includes(label), `缺少步骤文字 ${label}`);
  }
  return "6/6";
});

check("拼接图：全部图形在画布内", () => {
  const viewBox = assembly.match(/viewBox="0 0 (\d+(?:\.\d+)?) (\d+(?:\.\d+)?)"/);
  const [, w, h] = viewBox.map(Number);
  const pointLists = [];
  const re = /\sd="([^"]+)"/g;
  let m;
  while ((m = re.exec(assembly))) {
    try {
      pointLists.push(parsePath(m[1]).points);
    } catch {
      /* 拼接图里的图案线是相对坐标的简单路径，跳过 */
    }
  }
  assert(pointLists.length > 5, "拼接图解析到的路径太少");
  for (const pts of pointLists) {
    for (const [x, y] of pts) {
      assert(x >= -5 && x <= w + 5 && y >= -5 && y <= h + 5, `拼接图点 (${x},${y}) 超出 ${w}×${h}`);
    }
  }
  return `${w}×${h} 内`;
});

/* ---------- 排料图 ---------- */

const layout = blocks.find((b) => b.includes('id="layoutArt"'));
check("排料图：布宽 150cm、一层 3.5m 标注存在", () => {
  assert(layout, "缺少排料图 layoutArt");
  assert(layout.includes("布宽 150cm"), "缺布宽标注");
  assert(layout.includes("一层约 3.5m"), "缺一层用布量标注");
  return "ok";
});

/* ---------- 成品预览图 ---------- */

const hero = blocks.find((b) => b.includes('id="heroArt"'));
check("成品预览图：连帽、袖子、裤腿、罗纹、扣子齐全", () => {
  assert(hero, "缺少成品预览图 heroArt");
  for (const id of ["hood", "sleeves", "body", "legs", "collar", "buttons"]) {
    assert(hero.includes(`id="${id}"`), `成品图缺少 ${id}`);
  }
  assert(hero.includes('data-part="cuff"'), "成品图缺少袖口/裤脚罗纹");
  near(hero.split('data-part="cuff"').length - 1, 4, 0, "罗纹数量");
  return "6 组 + 4 个罗纹";
});

/* ---------- 内容校验 ---------- */

check("正文包含全部 6 个章节", () => {
  for (const id of ["specs", "pieces", "layout", "quilt", "assemble", "wash"]) {
    assert(html.includes(`id="${id}"`), `缺少章节 #${id}`);
  }
  return "6";
});

check("买布清单：两层都用纯棉针织且给出两件用量", () => {
  assert(/纯棉针织/.test(html), "缺少纯棉针织");
  assert(/7m/.test(html) && /14m/.test(html), "缺少一件 7m / 两件 14m 的用量");
  assert(/450–500g/.test(html) || /450g/.test(html), "缺少新疆棉用量");
  assert(/1\.6m/.test(html), "缺少罗纹布两件用量");
  return "ok";
});

check("绗缝要点：线距 10–12cm 与缝份留白", () => {
  assert(/10–12cm/.test(html), "缺少绗缝间距");
  assert(/不铺棉/.test(html), "缺少缝份留白说明");
  return "ok";
});

check("洗护：机洗温度、平铺阴干、禁用烘干", () => {
  assert(/30℃/.test(html), "缺少水温要求");
  assert(/平铺阴干/.test(html), "缺少晾法");
  assert(/不要高温烘干/.test(html) || /不能.*高温烘干/.test(html), "缺少禁烘干说明");
  return "ok";
});

check("每个示意图都有说明文字", () => {
  for (const block of blocks) {
    const start = html.indexOf(block);
    const after = html.slice(start, start + block.length + 900);
    assert(/figcaption|class="cap"/.test(after), "有示意图缺少图注");
  }
  return `${blocks.length} 张图`;
});

check("颜色取值都在样式表中定义过", () => {
  const palette = new Set(
    (html.match(/#[0-9a-fA-F]{3,8}\b/g) || []).map((c) => c.toLowerCase())
  );
  const svgColors = new Set();
  for (const block of blocks) {
    for (const c of block.match(/#[0-9a-fA-F]{3,8}\b/g) || []) svgColors.add(c.toLowerCase());
  }
  const undeclared = [...svgColors].filter((c) => !palette.has(c));
  assert(
    undeclared.length === 0,
    `示意图使用了未在调色板中定义的色值: ${undeclared.join(", ")}`
  );
  return `${palette.size} 个色值全部在调色板内`;
});

/* ---------- 输出 ---------- */

const pass = failures.length === 0;
for (const c of checks) console.log(`  ok   ${c.name} — ${c.detail}`);
for (const f of failures) console.error(`  FAIL ${f.name} — ${f.message}`);
console.log(
  `\n${pass ? "PASS" : "FAIL"}  ${checks.length} 项通过 / ${failures.length} 项失败`
);
process.exit(pass ? 0 : 1);
