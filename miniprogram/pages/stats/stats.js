// pages/stats/stats.js
Page({
  data: {
    loading: true,
    stats: null,
    maxDaily: 1,
    isAdmin: false,
    isInstructor: false,
    canViewAll: false,
    scope: 'mine',
    // 处理后的任务类型分布（含格式化时长、评分）
    missionList: [],
  },

  onShow() {
    this.load();
  },

  onPullDownRefresh() {
    this.load().then(() => wx.stopPullDownRefresh());
  },

  onScopeChange(e) {
    const { scope } = e.currentTarget.dataset;
    if (scope === this.data.scope) return;
    this.setData({ scope });
    this.load();
  },

  load() {
    this.setData({ loading: true });
    return wx.cloud
      .callFunction({
        name: 'flylog',
        data: { action: 'stats', scope: this.data.scope },
      })
      .then((res) => {
        this.setData({ loading: false });
        if (res.result && res.result.success) {
          const stats = res.result.data;
          const maxDaily = Math.max(
            1,
            ...(stats.daily || []).map((d) => d.count),
          );
          const missionList = this._processMissionList(stats.missionDistribution || []);
          this.setData({
            stats,
            maxDaily,
            missionList,
            isAdmin: !!stats.isAdmin,
            isInstructor: !!stats.isInstructor,
            canViewAll: !!stats.canViewAll,
            scope: stats.scope || 'mine',
          });
          // 数据写入后等待渲染，再绘制所有四芒星
          setTimeout(() => {
            missionList.forEach((_, idx) => this._drawRadar(idx));
          }, 100);
        }
      })
      .catch(() => this.setData({ loading: false }));
  },

  // 处理任务类型分布数据
  _processMissionList(list) {
    return list.map((item) => ({
      _id: item._id || '未填写',
      count: item.count || 0,
      duration: item.duration || 0,
      durationText: this._formatDuration(item.duration || 0),
      // 各维度均分，保留1位小数，缺失时默认0
      scores: {
        takeoffLanding: Math.round((item.avgTakeoffLanding || 0) * 10) / 10,
        driftRange: Math.round((item.avgDriftRange || 0) * 10) / 10,
        driftAltitude: Math.round((item.avgDriftAltitude || 0) * 10) / 10,
        routeIntegrity: Math.round((item.avgRouteIntegrity || 0) * 10) / 10,
      },
    }));
  },

  // 将秒数格式化为可读时长（与个人中心一致）
  _formatDuration(seconds) {
    if (!seconds || seconds <= 0) return '0 分钟';
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = seconds % 60;
    if (h > 0 && m > 0) return `${h} 小时 ${m} 分钟`;
    if (h > 0) return `${h} 小时 ${m} 分钟`;
    if (m > 0) return `${m} 分钟 ${s} 秒`;
    return `${s} 秒`;
  },

  // 绘制四芒星雷达图
  // 四轴：上=起降、右=范围漂移、下=高度漂移、左=航线完整
  // 分数展示由 canvas 外的图例负责，canvas 只绘制网格、数据区域和轴标签
  _drawRadar(idx) {
    const item = this.data.missionList[idx];
    if (!item) return;

    const query = wx.createSelectorQuery();
    query.select(`#radar-${idx}`)
      .fields({ node: true, size: true })
      .exec((res) => {
        if (!res || !res[0] || !res[0].node) return;
        const canvas = res[0].node;
        const { width, height } = res[0];
        const dpr = wx.getWindowInfo ? (wx.getWindowInfo().pixelRatio || 2) : 2;
        canvas.width = width * dpr;
        canvas.height = height * dpr;

        const ctx = canvas.getContext('2d');
        ctx.scale(dpr, dpr);

        const cx = width / 2;
        const cy = height / 2;
        const labelFontSize = Math.max(9, Math.round(width * 0.048));
        // 为标签留空间：上下留文字高度+间距，左右留最长标签宽度
        const labelH = labelFontSize + 6;
        const labelW = labelFontSize * 4.5; // "范围漂移" 约 4 字宽
        const maxR = Math.min(cx - labelW, cy - labelH);
        const maxScore = 5;

        ctx.clearRect(0, 0, width, height);

        // 四轴角度（弧度）：上、右、下、左
        const angles = [-Math.PI / 2, 0, Math.PI / 2, Math.PI];
        const labels = ['起降', '范围漂移', '高度漂移', '航线完整'];
        const scoreValues = [
          item.scores.takeoffLanding,
          item.scores.driftRange,
          item.scores.driftAltitude,
          item.scores.routeIntegrity,
        ];

        // 绘制背景网格（5级）
        for (let level = 1; level <= maxScore; level++) {
          const r = (level / maxScore) * maxR;
          ctx.beginPath();
          angles.forEach((a, i) => {
            const x = cx + r * Math.cos(a);
            const y = cy + r * Math.sin(a);
            if (i === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
          });
          ctx.closePath();
          ctx.strokeStyle = level === maxScore ? '#d0d7e8' : '#eaeff7';
          ctx.lineWidth = level === maxScore ? 1.5 : 1;
          ctx.stroke();
        }

        // 绘制轴线
        angles.forEach((a) => {
          ctx.beginPath();
          ctx.moveTo(cx, cy);
          ctx.lineTo(cx + maxR * Math.cos(a), cy + maxR * Math.sin(a));
          ctx.strokeStyle = '#d0d7e8';
          ctx.lineWidth = 1;
          ctx.stroke();
        });

        // 绘制数据区域
        ctx.beginPath();
        angles.forEach((a, i) => {
          const score = scoreValues[i] || 0;
          const r = (score / maxScore) * maxR;
          const x = cx + r * Math.cos(a);
          const y = cy + r * Math.sin(a);
          if (i === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        });
        ctx.closePath();
        ctx.fillStyle = 'rgba(0, 82, 217, 0.15)';
        ctx.fill();
        ctx.strokeStyle = '#0052d9';
        ctx.lineWidth = 2;
        ctx.stroke();

        // 绘制数据点
        angles.forEach((a, i) => {
          const score = scoreValues[i] || 0;
          const r = (score / maxScore) * maxR;
          const x = cx + r * Math.cos(a);
          const y = cy + r * Math.sin(a);
          ctx.beginPath();
          ctx.arc(x, y, 4, 0, Math.PI * 2);
          ctx.fillStyle = '#0052d9';
          ctx.fill();
        });

        // 绘制轴标签（轴末端外侧，不含分数）
        // 上下轴：水平居中；右轴：左对齐；左轴：右对齐
        const alignMap = ['center', 'left', 'center', 'right'];
        const baselineMap = ['bottom', 'middle', 'top', 'middle'];
        const labelGap = 6;

        ctx.font = `${labelFontSize}px sans-serif`;
        angles.forEach((a, i) => {
          const lx = cx + (maxR + labelGap) * Math.cos(a);
          const ly = cy + (maxR + labelGap) * Math.sin(a);
          ctx.textAlign = alignMap[i];
          ctx.textBaseline = baselineMap[i];
          ctx.fillStyle = '#555';
          ctx.fillText(labels[i], lx, ly);
        });
      });
  },
});
