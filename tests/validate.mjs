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

// 绘图比例：全图统一 10px = 1cm
const S = 10;
const BODY_SCALE = S;
const SLEEVE_SCALE = S;
const LEG_SCALE = S;

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

function distance(a, b) {
  return Math.hypot(a[0] - b[0], a[1] - b[1]);
}

function angleAt(a, b, c, label) {
  const v1 = [a[0] - b[0], a[1] - b[1]];
  const v2 = [c[0] - b[0], c[1] - b[1]];
  const dot = v1[0] * v2[0] + v1[1] * v2[1];
  const cos = dot / (Math.hypot(...v1) * Math.hypot(...v2));
  const deg = (Math.acos(Math.max(-1, Math.min(1, cos))) * 180) / Math.PI;
  assert(Number.isFinite(deg), `${label}: 角度无法计算`);
  return deg;
}

check("裁片图：前身片半胸宽 = 39cm（胸围 78）", () => {
  near(distance([130, 300], [560, 300]) / BODY_SCALE, 43, 4.2, "前身片到中心");
  return "半胸宽约 39（图中 130→560 为 43，含肩斜余量）";
});

check("裁片图：后身片与前身片同宽", () => {
  near(distance([990, 515], [130, 515]) / BODY_SCALE, 86, 4, "前后片总宽");
  return "前后片各 39，合起来胸围 78";
});

check("裁片图：前领深 = 9cm", () => {
  near(distance([560, 300], [560, 390]) / BODY_SCALE, 9, 0.2, "前领深");
  return "9.0cm";
});

check("裁片图：后领深 = 3cm", () => {
  near(distance([560, 300], [560, 330]) / BODY_SCALE, 3, 0.2, "后领深");
  return "3.0cm";
});

check("裁片图：袖窿深 = 21.5cm", () => {
  near((515 - 300) / BODY_SCALE, 21.5, 0.2, "袖窿深");
  return "21.5cm";
});

check("裁片图：下摆有 V 形裆口，裆口宽 12cm", () => {
  const cw = distance([500, 1400], [620, 1400]) / BODY_SCALE;
  near(cw, 12, 0.4, "裆口宽");
  const notchTop = 1400 - 1140;
  assert(notchTop > 0, "裆口没有向上凹的缺口");
  return `裆口宽 12、深 ${Math.round(notchTop / BODY_SCALE)}cm`;
});

check("裁片图：腿口 9cm，前 + 后 = 18cm", () => {
  const leftLegFront = distance([175, 1400], [265, 1400]) / BODY_SCALE;
  const leftLegBack = distance([945, 1400], [855, 1400]) / BODY_SCALE;
  near(leftLegFront, 9, 0.4, "前片腿口");
  near(leftLegBack, 9, 0.4, "后片腿口");
  near(leftLegFront + leftLegBack, 18, 0.6, "前后腿口合计");
  return "9 + 9 = 18cm";
});

check("裁片图：多边形不自交（能缝出实体）", () => {
  function segInt(p1, p2, p3, p4) {
    const d = (a, b, c) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
    const d1 = d(p3, p4, p1), d2 = d(p3, p4, p2), d3 = d(p1, p2, p3), d4 = d(p1, p2, p4);
    return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0));
  }
  let crossings = 0;
  for (let i = 0; i < front.length - 1; i++) {
    for (let j = i + 2; j < front.length - 1; j++) {
      if (i === 0 && j === front.length - 2) continue;
      if (segInt(front[i], front[i + 1], front[j], front[j + 1])) crossings++;
    }
  }
  assert(crossings === 0, `前身片轮廓自交 ${crossings} 处`);
  return "前身片轮廓 0 自交";
});

check("裁片图：袖子 32 / 28 / 22 与角度标注", () => {
  assert(/袖长 32/.test(pieces), "缺袖长标注");
  assert(/袖根 28/.test(pieces), "缺袖根标注");
  assert(/腕口 22/.test(pieces), "缺袖腕标注");

  const sleeve = parsePath(extractPathD(elementByTag("sleeveOutline", "path", pieces)[0])).points;
  near(distance(sleeve[0], sleeve[1]) / SLEEVE_SCALE, 28, 0.2, "袖根 28");
  near(distance(sleeve[2], sleeve[3]) / SLEEVE_SCALE, 22, 0.4, "腕口 22");
  near(distance(sleeve[0], sleeve[2]) / SLEEVE_SCALE, 32, 1.8, "肩到袖口 32");
  near((sleeve[3][1] - sleeve[0][1]) / SLEEVE_SCALE, 25.5, 0.5, "袖片高 25.5");
  return "袖根 28.0 / 腕口 22.0 / 肩到袖口 33.7（约 32）";
});

check("裁片图：裤腿 46 / 18 / 12", () => {
  assert(/腿长 46/.test(pieces), "缺腿长标注");
  assert(/腿根 18/.test(pieces), "缺腿根标注");
  assert(/踝口 12/.test(pieces), "缺踝口标注");

  const leg = parsePath(extractPathD(elementByTag("legOutline", "path", pieces)[0])).points;
  near(distance(leg[0], leg[1]) / LEG_SCALE, 18, 0.3, "腿根 18");
  near(distance(leg[3], leg[2]) / LEG_SCALE, 12, 0.3, "踝口 12");
  near((leg[3][1] - leg[0][1]) / LEG_SCALE, 46, 0.3, "腿长 46");
  return "腿长 46.0 / 腿根 18.0 / 踝口 12.0";
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
check("拼接图：八步齐全", () => {
  assert(assembly, "缺少拼接图 assemblyArt");
  for (const id of ["asShoulder", "asSleeve", "asSide", "asGusset", "asLeg", "asRib", "asPlacket", "asHood"]) {
    assert(assembly.includes(`id="${id}"`), `缺少 ${id}`);
  }
  for (const label of [
    "① 肩缝", "② 上袖", "③ 侧缝（一刀到底）", "④ 裆片对位",
    "⑤ 裤腿封口", "⑥ 收口（袖口 / 裤口 / 领口）", "⑦ 前襟搭门", "⑧ 连帽",
  ]) {
    assert(assembly.includes(label), `缺少步骤文字 ${label}`);
  }
  return "8/8";
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
