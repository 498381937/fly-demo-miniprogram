// pages/index/index.js
const app = getApp();

Page({
  data: {
    loading: true,
    stats: {
      totalFlights: 0,
      totalDurationSeconds: 0,
    },
    recentList: [],
  },

  onShow() {
    this.loadData();
  },

  onPullDownRefresh() {
    this.loadData().then(() => wx.stopPullDownRefresh());
  },

  loadData() {
    this.setData({ loading: true });
    const statsTask = wx.cloud.callFunction({
      name: 'flylog',
      data: { action: 'stats' },
    });
    const listTask = wx.cloud.callFunction({
      name: 'flylog',
      data: { action: 'list', pageSize: 5, pageIndex: 0 },
    });
    return Promise.all([statsTask, listTask])
      .then(([s, l]) => {
        this.setData({
          loading: false,
          stats:
            (s.result && s.result.success && s.result.data) ||
            { totalFlights: 0, totalDurationSeconds: 0 },
          recentList:
            (l.result && l.result.success && l.result.data.list) || [],
        });
      })
      .catch(() => {
        this.setData({ loading: false });
      });
  },

  formatDuration(sec) {
    if (!sec) return '00:00:00';
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    const s = sec % 60;
    const pad = (n) => (n < 10 ? '0' + n : '' + n);
    return `${pad(h)}:${pad(m)}:${pad(s)}`;
  },

  goReport() {
    wx.switchTab({ url: '/pages/report/report' });
  },
  goQuery() {
    wx.switchTab({ url: '/pages/query/query' });
  },
  goStats() {
    wx.switchTab({ url: '/pages/stats/stats' });
  },
  goDetail(e) {
    const { id } = e.currentTarget.dataset;
    wx.navigateTo({ url: `/pages/detail/detail?id=${id}` });
  },

  // 分享给好友
  onShareAppMessage() {
    return {
      title: '多旋翼无人机飞行云日志填报系统',
      path: '/pages/index/index',
      // 可选：自定义分享卡片图（450×360，本地或网络图，不填则自动截图当前页）
      // imageUrl: '/images/share-cover.png',
    };
  },

  // 分享到朋友圈（基础库 ≥ 2.11.3 支持）
  onShareTimeline() {
    return {
      title: '多旋翼无人机飞行云日志填报系统',
      query: '',
    };
  },
});
