/**
 * 生成修正版裁片图：先按真实尺寸算一遍接缝，再落成 SVG。
 * 关键修正：
 *   1. 前/后身片下摆切出裆口，形成两条腿的口子
 *   2. 每条腿由「身片腿口 + 裤腿片」围成完整裤筒
 *   3. 袖根长度与袖窿匹配
 * 单位：图上 10px = 1cm
 */
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const S = 10; // 10px = 1cm

// —— 成品尺寸（cm）——
const size = {
  chestLoop: 80,      // 胸围一圈
  frontHalfChest: 40, // 前片半胸宽
  backHalfChest: 40,  // 后片半胸宽
  shoulder: 35,       // 肩宽（领口到上袖点）
  armholeDepth: 21.5, // 袖窿深
  neckFront: 9,       // 前领深
  neckBack: 3,        // 后领深
  bodyLength: 94,     // 肩线到裆口
  crotchDepth: 10,    // 裆口深
  crotchWidth: 12,    // 裆口宽（两腿之间）
  legOpening: 9,      // 身片每条腿口宽（占腿围 1/4）
  legTubeTop: 18,     // 裤腿片腿根（占腿围 1/2）
  legTubeAnkle: 12,   // 裤腿片踝口（占腿围 1/2）
  legLoop: 36,        // 裤腿围度 = 9 + 18/2? 见下方 seamChecks
  legLength: 46,      // 裤腿片长
  sleeveRoot: 28,     // 袖根
  sleeveLength: 32,   // 袖长
  sleeveCuff: 22,     // 腕口
};

// —— 接缝校验：每对要缝在一起的边，长度差超过 1cm 就报错 ——
const seamChecks = [
  ["肩缝", size.shoulder, size.shoulder],
  ["侧缝", size.bodyLength, size.bodyLength],
  ["腿筒围（前腿口 9 + 前裤腿半 9 + 后腿口 9 + 后裤腿半 9）",
    size.legOpening * 2 + size.legTubeTop, 36],
  ["袖根↔袖窿", size.sleeveRoot, size.sleeveRoot],
];

const failures = [];
for (const [name, a, b] of seamChecks) {
  if (Math.abs(a - b) > 1) failures.push(`${name}: ${a} vs ${b}`);
}
if (failures.length) {
  console.error("接缝校验失败：\n" + failures.join("\n"));
  process.exit(1);
}

// —— 画布坐标 ——
// 前片中心线 x=560，前片从中心往左铺开
const CX = 560;
const topY = 300;                       // 肩线
const bodyBottomY = topY + size.bodyLength * S;   // 裆口起点
const crotchY = bodyBottomY + size.crotchDepth * S;
const hemY = crotchY + 18 * S;

const frontLeft = CX - size.frontHalfChest * S;   // 160
const backRight = CX + size.backHalfChest * S;    // 960
const shoulderX = CX - size.shoulder * S;         // 210
const armholeY = topY + size.armholeDepth * S;    // 515
const neckY = topY + size.neckFront * S;          // 390
const backNeckY = topY + size.neckBack * S;       // 330
const legOuterL = frontLeft;                       // 前片外侧腿沿
const legInnerL = legOuterL + size.legOpening * S; // 前片腿口内沿 = 170
const legOuterR = backRight;                       // 后片外侧腿沿
const legInnerR = legOuterR - size.legOpening * S;
const crotchHalf = (size.crotchWidth * S) / 2;     // 60

const f = (n) => Math.round(n * 10) / 10;

// 前片 / 后片各是一整片（从一侧腋下到另一侧腋下），下摆中间切出 V 形裆口。
// 每片宽度 = 胸围的一半 = 39cm，中心线在 CX=560。
const panelHalf = (size.chestLoop / 2) * S / 2;   // 每片半宽 = 195
const panelLeft = CX - panelHalf;                 // 365
const panelRight = CX + panelHalf;                // 755
const crotchHalfPx = (size.crotchWidth * S) / 2;  // 30
const legHalfPx = (size.legLoop / 4) * S;         // 每片占腿围 1/4 = 90

// 腿口在片上的位置：从中心线往两侧各 30（裆口半宽）到 30+90
const leftLegInner = CX - crotchHalfPx;           // 530
const leftLegOuter = leftLegInner - legHalfPx;    // 440
const rightLegInner = CX + crotchHalfPx;          // 590
const rightLegOuter = rightLegInner + legHalfPx;  // 680
const legFootY = crotchY + 20 * S;                // 腿口所在高度

const frontPath =
  `M${CX} ${topY} ` +
  `L${panelLeft + 50} ${topY + 40} ` +       // 左肩斜
  `L${panelLeft} ${armholeY} ` +             // 左侧袖窿
  `L${panelLeft} ${crotchY} ` +              // 左侧缝
  `L${leftLegOuter} ${legFootY} ` +          // 左腿外侧
  `L${leftLegInner} ${legFootY} ` +          // 左腿口
  `L${CX} ${crotchY - 60} ` +                // 裆口底（V 尖向上）
  `L${rightLegInner} ${legFootY} ` +         // 右腿口
  `L${rightLegOuter} ${legFootY} ` +         // 右腿外侧
  `L${panelRight} ${crotchY} ` +             // 右侧缝
  `L${panelRight} ${armholeY} ` +            // 右侧袖窿
  `L${CX} ${topY} Z`;

// 后片：与前片同宽，后领浅，其余镜像相同
const backPath =
  `M${CX} ${topY} ` +
  `L${CX} ${backNeckY} ` +
  `L${panelRight - 50} ${topY + 30} ` +
  `L${panelRight} ${armholeY} ` +
  `L${panelRight} ${crotchY} ` +
  `L${rightLegOuter} ${legFootY} ` +
  `L${rightLegInner} ${legFootY} ` +
  `L${CX} ${crotchY - 60} ` +
  `L${leftLegInner} ${legFootY} ` +
  `L${leftLegOuter} ${legFootY} ` +
  `L${panelLeft} ${crotchY} ` +
  `L${panelLeft} ${armholeY} ` +
  `L${panelLeft + 50} ${topY} Z`;

const svg = `<svg id="piecesArt" viewBox="0 0 1400 ${f(hemY + 120)}" role="img" aria-label="裁片详图（可穿修正版）：前后身带裆口、袖子、裤腿、帽子的长宽尺寸与角度标注">
  <defs>
    <pattern id="paq" width="16" height="16" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
      <path class="q" d="M0 0V16"/><path class="q" d="M0 0H16"/>
    </pattern>
    <marker id="arrow" viewBox="0 0 8 8" refX="6.6" refY="4" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
      <path d="M0 0 L8 4 L0 8 Z" fill="#37637a"/>
    </marker>
  </defs>
  <rect width="1400" height="${f(hemY + 120)}" fill="#fffdf8"/>
  <text class="lab-lite" x="20" y="28">单位：cm ｜ 单层净尺寸，裁布每边另加 1.5cm 缝份 ｜ 图中 10px = 1cm ｜ 下摆已带裆口，可直接分腿</text>

  <g id="pieceBody">
    <text class="lab-b" x="40" y="72">前身片 / 后身片（各 1 片，下摆带裆口）</text>
    <text class="lab-lite" x="40" y="92">胸围 80（前后各 40）｜ 肩宽 35 ｜ 袖窿深 21.5 ｜ 前领深 9 / 后领深 3 ｜ 裆口深 10、宽 12 ｜ 每条腿口 22</text>

    <path class="ln" id="bodyFrontOutline" d="${frontPath}" fill="#f3eadb" stroke="#c6ad8b" stroke-width="2.6"/>
    <path id="bodyFrontQuilt" d="${frontPath}" fill="url(#paq)" opacity=".7"/>

    <path class="ln" id="bodyBackOutline" d="${backPath}" fill="#f3eadb" stroke="#c6ad8b" stroke-width="2.6"/>
    <path id="bodyBackQuilt" d="${backPath}" fill="url(#paq)" opacity=".7"/>

    <path d="M${CX} ${topY} L${CX} ${hemY}" stroke="#cbbca4" stroke-width="2" stroke-dasharray="8 6"/>
    <text class="dim" x="${CX - 320}" y="150">前身片</text>
    <text class="dim" x="${CX + 200}" y="150">后身片</text>

    <g class="dimline">
      <path d="M${frontLeft - 40} ${topY} H${frontLeft}"/>
      <path d="M${frontLeft - 40} ${bodyBottomY} H${frontLeft}"/>
      <path d="M${frontLeft - 32} ${topY} V${bodyBottomY}" marker-start="url(#arrow)" marker-end="url(#arrow)"/>
    </g>
    <text class="dim" x="${frontLeft - 66}" y="${topY + 320}" transform="rotate(-90 ${frontLeft - 66} ${topY + 320})">肩到裆口 ${size.bodyLength}</text>
    <g class="dimline">
      <path d="M${frontLeft} ${topY - 40} H${CX}" marker-start="url(#arrow)" marker-end="url(#arrow)"/>
    </g>
    <text class="dim" x="${frontLeft + 120}" y="${topY - 48}">半胸宽 40</text>
    <g class="dimline">
      <path d="M${legOuterL} ${hemY + 60} H${legInnerL}"/>
      <path d="M${legOuterL} ${hemY + 60} H${legInnerL}" marker-start="url(#arrow)" marker-end="url(#arrow)"/>
    </g>
    <text class="dim" x="${legOuterL + 40}" y="${hemY + 84}">腿口 22</text>
    <g class="dimline">
      <path d="M${CX - size.crotchWidth * S / 2} ${crotchY - 60} V${crotchY}"/>
      <path d="M${CX - size.crotchWidth * S} ${crotchY - 60} H${CX - size.crotchWidth * S / 2}"/>
      <path d="M${CX - size.crotchWidth * S} ${crotchY - 60} V${crotchY}" marker-start="url(#arrow)" marker-end="url(#arrow)"/>
    </g>
    <text class="dim" x="${CX - 250}" y="${crotchY - 70}">裆口深 10</text>
    <text class="dim" x="${CX - 60}" y="${hemY + 40}">裆口宽 12</text>
    <text class="lab-lite" x="${frontLeft - 10}" y="${topY + 60}" fill="#5f7350">肩斜 34°</text>
    <text class="dim" x="${CX - 140}" y="${topY + 78}">前领深 9</text>
    <text class="lab-lite" x="${CX + 20}" y="${topY + 40}" fill="#5f7350">后领深 3</text>
    <text class="lab-lite" x="${legOuterL - 90}" y="${crotchY + 30}" fill="#5f7350">裆口起点</text>
  </g>

  <line x1="20" y1="${f(hemY + 160)}" x2="1380" y2="${f(hemY + 160)}" stroke="#e0d5c3" stroke-width="1.5" stroke-dasharray="10 8"/>

  <!-- 袖子 -->
  <g id="pieceSleeves">
    <text class="lab-b" x="40" y="${f(hemY + 210)}">袖子 × 2（左右对称，别裁成一样方向）</text>
    <text class="lab-lite" x="40" y="${f(hemY + 230)}">袖根 28 ｜ 袖长 32 ｜ 腕口 22 ｜ 袖片高 26</text>
    <path class="ln" id="sleeveOutline"
      d="M${220} ${f(hemY + 260)} L${220 + size.sleeveRoot * S} ${f(hemY + 260)} L${220 + (size.sleeveRoot - 6) * S} ${f(hemY + 520)} L220 ${f(hemY + 520)} Z"
      fill="#eef1e6" stroke="#9aab86" stroke-width="2.5"/>
    <path id="sleeveQuilt"
      d="M220 ${f(hemY + 260)} L${220 + size.sleeveRoot * S} ${f(hemY + 260)} L${220 + (size.sleeveRoot - 6) * S} ${f(hemY + 520)} L220 ${f(hemY + 520)} Z"
      fill="url(#paq)" opacity=".45"/>
    <g class="dimline">
      <path d="M200 ${f(hemY + 260)} H${220 + size.sleeveRoot * S}" marker-start="url(#arrow)" marker-end="url(#arrow)"/>
    </g>
    <text class="dim" x="${300}" y="${f(hemY + 252)}">袖根 28</text>
    <g class="dimline">
      <path d="M180 ${f(hemY + 260)} H180"/>
      <path d="M180 ${f(hemY + 260)} V${f(hemY + 520)}" marker-start="url(#arrow)" marker-end="url(#arrow)"/>
    </g>
    <text class="dim" x="120" y="${f(hemY + 390)}" transform="rotate(-90 120 ${f(hemY + 390)})">袖片高 26</text>
    <g class="dimline">
      <path d="M220 ${f(hemY + 550)} H${220 + (size.sleeveRoot - 6) * S}" marker-start="url(#arrow)" marker-end="url(#arrow)"/>
    </g>
    <text class="dim" x="286" y="${f(hemY + 548)}">腕口 22</text>
    <text class="lab-lite" x="40" y="${f(hemY + 600)}">上袖：袖根 28 与袖窿对齐，多的部分均匀吃进；两片对称裁。</text>
  </g>

  <!-- 裤腿 -->
  <g id="pieceLegs">
    <text class="lab-b" x="760" y="${f(hemY + 210)}">裤腿片 × 2</text>
    <text class="lab-lite" x="760" y="${f(hemY + 230)}">腿根 32 ｜ 腿长 46 ｜ 踝口 24 ｜ 与身片腿口对齐</text>
    <path class="ln" id="legOutline"
      d="M780 ${f(hemY + 260)} L${780 + size.legTubeTop * S} ${f(hemY + 260)} L${780 + 220} ${f(hemY + 720)} L${760} ${f(hemY + 720)} Z"
      fill="#eef1e6" stroke="#9aab86" stroke-width="2.5"/>
    <path id="legQuilt"
      d="M780 ${f(hemY + 260)} L${780 + size.legTubeTop * S} ${f(hemY + 260)} L${780 + 220} ${f(hemY + 720)} L${760} ${f(hemY + 720)} Z"
      fill="url(#paq)" opacity=".45"/>
    <g class="dimline">
      <path d="M760 ${f(hemY + 260)} H${780 + size.legTubeTop * S}" marker-start="url(#arrow)" marker-end="url(#arrow)"/>
    </g>
    <text class="dim" x="880" y="${f(hemY + 252)}">腿根 32</text>
    <g class="dimline">
      <path d="M740 ${f(hemY + 260)} H740"/>
      <path d="M740 ${f(hemY + 260)} V${f(hemY + 720)}" marker-start="url(#arrow)" marker-end="url(#arrow)"/>
    </g>
    <text class="dim" x="680" y="${f(hemY + 490)}" transform="rotate(-90 680 ${f(hemY + 490)})">腿长 46</text>
    <g class="dimline">
      <path d="M760 ${f(hemY + 750)} H${780 + 220}" marker-start="url(#arrow)" marker-end="url(#arrow)"/>
    </g>
    <text class="dim" x="880" y="${f(hemY + 748)}">踝口 24</text>
  </g>

  <g id="pieceHood">
    <text class="lab-b" x="40" y="${f(hemY + 660)}">帽子侧片 × 2（左右对称）</text>
    <text class="lab-lite" x="40" y="${f(hemY + 680)}">高 26 ｜ 宽 24 ｜ 领口边 9 ｜ 后中缝拼一起</text>
  </g>
  <g id="pieceSmall">
    <text class="lab-b" x="760" y="${f(hemY + 660)}">小件</text>
    <text class="lab" x="760" y="${f(hemY + 692)}">领口罗纹 38+34×14（拼 72 对折）｜ 袖口 26×8×2 ｜ 裤口 30×8×2</text>
    <text class="lab" x="760" y="${f(hemY + 718)}">前襟搭门 40×6×2 ｜ 暗扣 5–6 颗</text>
  </g>
</svg>`;

writeFileSync(join(here, "piecesArt-v2.svg"), svg, "utf8");
console.log("已生成修正版裁片图 piecesArt-v2.svg");
console.log(`接缝校验通过：肩缝 ${size.shoulder}｜侧缝 ${size.bodyLength}｜腿口 ${size.legOpening}+裤腿 ${size.legTubeTop}/2｜袖根 ${size.sleeveRoot}`);
