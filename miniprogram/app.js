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

  globalData: {
    // 请替换为你的云开发环境 ID（在微信开发者工具 -> 云开发 控制台查看）
    envId: 'cloud1-d1goamb98422359ec',
    userInfo: null,
    draft: null,
    // 无人机型号下拉选项
    droneModels: ['模拟器','四旋翼飞行器','F450','大疆御Air3', '大疆御mini3', '大疆精灵4RTK'],
    // 飞行任务类型
    missionTypes: ['对尾悬停', '对左悬停', '对右悬停', '对头悬停', '“口”字航线', '“十”字航线', '“M”字航线', '“米”字航线', '环绕航线', '“八”字航线'],
    // 飞行模式
    flightModes: [ '姿态', '定高','GPS', '手动'],
    // 飞行前检查结果
    checkResults: ['合格', '不合格'],
  },
});
