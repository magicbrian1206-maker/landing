/**
 * 每日燦坤華榮 AppleShop 點擊報表寄送
 * 由 GitHub Actions 每天 21:30 (台灣) 自動執行
 */
const fetch = require('node-fetch');
const nodemailer = require('nodemailer');
const XLSX = require('xlsx');

const NS = 'tsann-kuen-appleshop';
const BRANDS = [
  { key: 'line',   name: 'LINE 加好友',  color: '#06C755' },
  { key: 'fb',     name: 'FB 按讚',      color: '#1877F2' },
  { key: 'google', name: 'Google 五星',  color: '#EA4335' },
];
const DASHBOARD = 'https://magicbrian1206-maker.github.io/landing/stats.html';
const LANDING   = 'https://magicbrian1206-maker.github.io/landing/';

const pad = n => n < 10 ? '0' + n : '' + n;
const dayKey = d => `${d.getFullYear()}${pad(d.getMonth()+1)}${pad(d.getDate())}`;
const monthKey = d => `${d.getFullYear()}${pad(d.getMonth()+1)}`;

async function fetchKey(key) {
  try {
    const r = await fetch(`https://abacus.jasoncameron.dev/get/${NS}/${key}`);
    if (!r.ok) return 0;
    const j = await r.json();
    return j.value ?? 0;
  } catch (e) { return 0; }
}

function lastNDays(n) {
  const arr = [];
  for (let i = 0; i < n; i++) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    arr.push(d);
  }
  return arr;
}

// 用 QuickChart.io 產生折線圖 URL（內嵌到 email 用）
function buildLineChartUrl(labels, datasets) {
  const cfg = {
    type: 'line',
    data: {
      labels,
      datasets: datasets.map(d => ({
        label: d.label,
        data: d.data,
        borderColor: d.color,
        backgroundColor: d.color + '33',
        fill: false,
        tension: 0.35,
        borderWidth: 2,
        pointRadius: 2,
      }))
    },
    options: {
      plugins: {
        legend: { labels: { color: '#1d1d1f', font: { size: 12 } } },
        title:  { display: true, text: '近 30 日趨勢', color: '#1d1d1f', font: { size: 16, weight: 'bold' } }
      },
      scales: {
        x: { ticks: { color: '#666' } },
        y: { beginAtZero: true, ticks: { color: '#666', precision: 0 } }
      }
    }
  };
  return `https://quickchart.io/chart?w=600&h=300&bkg=white&c=${encodeURIComponent(JSON.stringify(cfg))}`;
}

// 用 QuickChart.io 產生熱力圖 URL（用 matrix）
function buildHeatmapUrl(cells) {
  // cells: [{x: 'W1', y: '一', v: count}, ...]
  const cfg = {
    type: 'matrix',
    data: {
      datasets: [{
        label: '每日點擊',
        data: cells,
        backgroundColor: ctx => {
          const v = ctx.dataset.data[ctx.dataIndex].v;
          if (v === 0) return '#eeeeee';
          const max = 20;
          const a = Math.min(v / max, 1);
          return `rgba(255, 184, 0, ${0.2 + 0.8 * a})`;
        },
        width: ({chart}) => (chart.chartArea || {}).width / 12 - 2,
        height: ({chart}) => (chart.chartArea || {}).height / 7 - 2,
      }]
    },
    options: {
      plugins: {
        legend: { display: false },
        title:  { display: true, text: '近 12 週熱力圖', color: '#1d1d1f', font: { size: 16, weight: 'bold' } }
      },
      scales: {
        x: { type: 'category', labels: Array.from({length:12},(_,i)=>`W${i+1}`), grid:{display:false} },
        y: { type: 'category', labels: ['日','一','二','三','四','五','六'], grid:{display:false} }
      }
    }
  };
  return `https://quickchart.io/chart?w=600&h=240&bkg=white&v=4&c=${encodeURIComponent(JSON.stringify(cfg))}`;
}

async function buildReport() {
  const today = new Date();
  const todayKey = dayKey(today);
  const monthKy = monthKey(today);

  // 今日各品牌
  const todayCounts = await Promise.all(BRANDS.map(b => fetchKey(`${b.key}-d-${todayKey}`)));
  // 本月各品牌
  const monthCounts = await Promise.all(BRANDS.map(b => fetchKey(`${b.key}-m-${monthKy}`)));
  // 終身各品牌
  const lifetimeCounts = await Promise.all(BRANDS.map(b => fetchKey(b.key)));

  // 近 30 天每日數據（折線圖）
  const days30 = lastNDays(30).reverse(); // 舊→新
  const labels = days30.map(d => `${d.getMonth()+1}/${d.getDate()}`);
  const datasets = [];
  for (const b of BRANDS) {
    const data = await Promise.all(days30.map(d => fetchKey(`${b.key}-d-${dayKey(d)}`)));
    datasets.push({ label: b.name, data, color: b.color });
  }

  // 近 12 週熱力圖數據
  const heatCells = [];
  const days84 = lastNDays(84).reverse();
  for (let i = 0; i < days84.length; i++) {
    const d = days84[i];
    const counts = await Promise.all(BRANDS.map(b => fetchKey(`${b.key}-d-${dayKey(d)}`)));
    const v = counts.reduce((a,b)=>a+b, 0);
    const week = Math.floor(i / 7) + 1;
    const dow = ['日','一','二','三','四','五','六'][d.getDay()];
    heatCells.push({ x: `W${week}`, y: dow, v });
  }

  return { todayCounts, monthCounts, lifetimeCounts, days30, datasets, labels, heatCells };
}

function buildHtmlEmail(r) {
  const today = new Date();
  const dateStr = today.toLocaleDateString('zh-TW', { year:'numeric', month:'long', day:'numeric', weekday:'long' });
  const total = r.todayCounts.reduce((a,b)=>a+b,0);
  const lineChartUrl = buildLineChartUrl(r.labels, r.datasets);
  const heatmapUrl = buildHeatmapUrl(r.heatCells);

  const recordRows = BRANDS.map((b, i) => `
    <tr>
      <td style="padding:10px 12px;border-bottom:1px solid #eee;">
        <span style="display:inline-block;width:10px;height:10px;background:${b.color};border-radius:50%;margin-right:6px;"></span>
        ${b.name}
      </td>
      <td style="text-align:right;padding:10px 12px;border-bottom:1px solid #eee;font-weight:700;">${r.todayCounts[i]}</td>
      <td style="text-align:right;padding:10px 12px;border-bottom:1px solid #eee;color:#888;">${r.monthCounts[i]}</td>
      <td style="text-align:right;padding:10px 12px;border-bottom:1px solid #eee;color:#888;">${r.lifetimeCounts[i]}</td>
    </tr>
  `).join('');

  return `<!DOCTYPE html>
<html><body style="margin:0;padding:0;font-family:-apple-system,BlinkMacSystemFont,'PingFang TC','Microsoft JhengHei',sans-serif;background:#f5f5f7;color:#1d1d1f;">
<table cellspacing="0" cellpadding="0" border="0" align="center" width="600" style="margin:24px auto;background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 4px 16px rgba(0,0,0,0.08);">
  <tr>
    <td style="background:linear-gradient(135deg,#FFD500,#FFB800);padding:24px;border-bottom:6px solid #1d1d1f;">
      <h1 style="margin:0;font-size:22px;color:#1d1d1f;">📊 每日點擊報表</h1>
      <p style="margin:4px 0 0;color:#5a4a00;font-size:13px;">燦坤華榮 AppleShop · ${dateStr}</p>
    </td>
  </tr>

  <tr>
    <td style="padding:24px;">
      <!-- 今日總計 -->
      <div style="text-align:center;background:#1d1d1f;color:#fff;padding:18px;border-radius:12px;margin-bottom:20px;">
        <div style="font-size:11px;letter-spacing:2px;color:#8e8e93;">TODAY TOTAL</div>
        <div style="font-size:48px;font-weight:800;color:#FFD500;line-height:1.1;">${total}</div>
        <div style="font-size:12px;color:#aaa;">今日總點擊</div>
      </div>

      <!-- 紀錄表 -->
      <h3 style="margin:0 0 8px;font-size:15px;border-left:3px solid #FFD500;padding-left:8px;">📋 詳細紀錄</h3>
      <table cellspacing="0" cellpadding="0" border="0" width="100%" style="font-size:13px;border:1px solid #eee;border-radius:8px;overflow:hidden;">
        <tr style="background:#fafafa;color:#888;">
          <th style="text-align:left;padding:8px 12px;font-weight:600;">指標</th>
          <th style="text-align:right;padding:8px 12px;font-weight:600;">今日</th>
          <th style="text-align:right;padding:8px 12px;font-weight:600;">本月</th>
          <th style="text-align:right;padding:8px 12px;font-weight:600;">累計</th>
        </tr>
        ${recordRows}
      </table>

      <!-- 折線圖 -->
      <h3 style="margin:24px 0 8px;font-size:15px;border-left:3px solid #FFD500;padding-left:8px;">📈 近 30 日趨勢</h3>
      <img src="${lineChartUrl}" alt="近 30 日趨勢圖" style="width:100%;border-radius:8px;border:1px solid #eee;">

      <!-- 熱力圖 -->
      <h3 style="margin:24px 0 8px;font-size:15px;border-left:3px solid #FFD500;padding-left:8px;">🔥 近 12 週熱力圖</h3>
      <img src="${heatmapUrl}" alt="近 12 週熱力圖" style="width:100%;border-radius:8px;border:1px solid #eee;">

      <!-- 連結 -->
      <div style="margin-top:24px;text-align:center;">
        <a href="${DASHBOARD}" style="display:inline-block;background:#1d1d1f;color:#FFD500;padding:12px 24px;border-radius:10px;text-decoration:none;font-weight:600;font-size:14px;margin:4px;">📊 完整儀表板</a>
        <a href="${LANDING}" style="display:inline-block;background:#fff;color:#1d1d1f;border:1px solid #ddd;padding:12px 24px;border-radius:10px;text-decoration:none;font-weight:600;font-size:14px;margin:4px;">🔗 落地頁</a>
      </div>

      <p style="margin-top:18px;color:#888;font-size:11px;text-align:center;line-height:1.6;">
        詳細 90 天紀錄請見附件 Excel。<br>
        © 2026 燦坤華榮 AppleShop · 此報表由系統自動產生於 ${today.toLocaleString('zh-TW')}
      </p>
    </td>
  </tr>
</table>
</body></html>`;
}

function buildExcel(r) {
  const today = new Date();
  const summary = [
    ['指標', '今日', '本月', '累計'],
    ...BRANDS.map((b, i) => [b.name, r.todayCounts[i], r.monthCounts[i], r.lifetimeCounts[i]]),
    ['總計',
      r.todayCounts.reduce((a,b)=>a+b,0),
      r.monthCounts.reduce((a,b)=>a+b,0),
      r.lifetimeCounts.reduce((a,b)=>a+b,0)
    ],
    [],
    ['報表時間', today.toLocaleString('zh-TW')],
  ];

  const dailyHeader = ['日期', ...BRANDS.map(b => b.name), '總計'];
  const daily = [dailyHeader];
  // r.days30 是舊→新
  for (let i = 0; i < r.days30.length; i++) {
    const d = r.days30[i];
    const row = [
      `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`,
      ...r.datasets.map(ds => ds.data[i])
    ];
    row.push(row.slice(1).reduce((a,b)=>a+b,0));
    daily.push(row);
  }

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(summary), '總覽');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(daily), '每日紀錄_30天');
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
}

(async () => {
  console.log('📊 抓取資料中...');
  const r = await buildReport();

  console.log('✉️  組合 email 中...');
  const html = buildHtmlEmail(r);
  const xlsx = buildExcel(r);

  const today = new Date();
  const dateLabel = `${today.getFullYear()}${pad(today.getMonth()+1)}${pad(today.getDate())}`;

  const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
      user: process.env.GMAIL_USER,
      pass: process.env.GMAIL_APP_PASSWORD,
    }
  });

  console.log(`📧 寄送至 ${process.env.REPORT_TO}...`);
  await transporter.sendMail({
    from: `"燦坤華榮 AppleShop 報表" <${process.env.GMAIL_USER}>`,
    to: process.env.REPORT_TO,
    subject: `📊 [燦坤華榮] ${today.getMonth()+1}/${today.getDate()} 點擊統計 (今日 ${r.todayCounts.reduce((a,b)=>a+b,0)} 次)`,
    html,
    attachments: [{
      filename: `燦坤華榮AppleShop-${dateLabel}.xlsx`,
      content: xlsx,
    }]
  });

  console.log('✅ 寄送完成');
})().catch(e => {
  console.error('❌ 錯誤：', e);
  process.exit(1);
});
