// utils/util.js
// 日期时间格式化和通用工具

const pad = (n) => (n < 10 ? '0' + n : '' + n);

const formatDate = (date) => {
  const d = date instanceof Date ? date : new Date(date);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

const formatTime = (date) => {
  const d = date instanceof Date ? date : new Date(date);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
};

const formatDateTime = (date) => {
  const d = date instanceof Date ? date : new Date(date);
  return `${formatDate(d)} ${formatTime(d)}`;
};

/**
 * 计算两个 HH:MM:SS 的时间差，返回 HH:MM:SS 字符串
 * @param {string} start 起飞时间 HH:MM:SS
 * @param {string} end 降落时间 HH:MM:SS
 */
const diffDuration = (start, end) => {
  if (!start || !end) return '';
  const [sh, sm, ss] = start.split(':').map(Number);
  const [eh, em, es] = end.split(':').map(Number);
  let secs = eh * 3600 + em * 60 + es - (sh * 3600 + sm * 60 + ss);
  if (secs < 0) secs += 24 * 3600;
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = secs % 60;
  return `${pad(h)}:${pad(m)}:${pad(s)}`;
};

/**
 * 把 HH:MM:SS 转秒
 */
const hmsToSeconds = (hms) => {
  if (!hms) return 0;
  const [h, m, s] = hms.split(':').map(Number);
  return h * 3600 + m * 60 + s;
};

/**
 * 生成日志编号：FLY-YYYYMMDD-NNN
 * @param {number} index 当日序号
 */
const genLogCode = (date, index) => {
  const d = date ? new Date(date) : new Date();
  const ymd = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`;
  return `FLY-${ymd}-${String(index).padStart(3, '0')}`;
};

module.exports = {
  formatDate,
  formatTime,
  formatDateTime,
  diffDuration,
  hmsToSeconds,
  genLogCode,
};
