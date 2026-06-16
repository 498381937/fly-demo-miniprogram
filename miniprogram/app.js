// app.js
App({
  onLaunch() {
    if (!wx.cloud) {
      console.error('请使用 2.2.3 或以上基础库以使用云能力');
    } else {
      wx.cloud.init({
        // env 参数需替换为实际的云开发环境 ID
        env: this.globalData.envId,
        traceUser: true,
      });
      // 云初始化完成后查询待审批数量
      this.fetchPendingApprovalCount();
    }

    // 读取本地缓存的用户信息
    const userInfo = wx.getStorageSync('userInfo');
    if (userInfo) {
      this.globalData.userInfo = userInfo;
    }

    // 读取本地草稿（用于离线缓存恢复）
    const draft = wx.getStorageSync('reportDraft');
    if (draft) {
      this.globalData.draft = draft;
    }
  },

  // 查询待审批数量并更新 tab 徽标
  fetchPendingApprovalCount() {
    wx.cloud
      .callFunction({ name: 'flylog', data: { action: 'get_pending_approval_count' } })
      .then((res) => {
        if (res.result && res.result.success) {
          const total = res.result.data.total || 0;
          this.globalData.pendingApprovalCount = total;
          this.updateApprovalTabBadge(total);
        }
      })
      .catch((err) => {
        console.warn('[app] fetchPendingApprovalCount failed:', err);
      });
  },

  // 更新"个人中心" tab（index=4）的徽标
  updateApprovalTabBadge(count) {
    // 个人中心为 tabBar list 第 5 项，下标为 4
    const TAB_INDEX = 4;
    if (count > 0) {
      wx.setTabBarBadge({ index: TAB_INDEX, text: String(count > 99 ? '99+' : count) });
    } else {
      wx.removeTabBarBadge({ index: TAB_INDEX });
    }
  },

  globalData: {
    // 请替换为你的云开发环境 ID（在微信开发者工具 -> 云开发 控制台查看）
    envId: 'cloud1-d1goamb98422359ec',
    userInfo: null,
    draft: null,
    pendingApprovalCount: 0,
    // 无人机型号下拉选项
    droneModels: ['模拟器','四旋翼飞行器','F450','大疆御Air3', '大疆御mini3', '大疆精灵4RTK'],
    // 飞行任务类型
    missionTypes: ['对尾悬停', '对左悬停', '对右悬停', '对头悬停', '"口"字航线', '"十"字航线', '"M"字航线', '"米"字航线', '环绕航线', '"八"字航线', '自由训练'],
    // 飞行模式
    flightModes: [ '姿态', '定高','GPS', '手动'],
    // 飞行前检查结果
    checkResults: ['合格', '不合格'],
  },
});
