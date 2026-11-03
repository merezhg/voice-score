// =============================================================
//  测评结果设计：维度、声线类型库、段位、本地文案素材
//  前端和本地引擎共用；AI 只能从 TYPES 里选声线，保证视觉统一
// =============================================================
window.VOICE_DESIGN = (function () {
  // 朗读文本：key 是文本里最适合被"点名夸奖"的词
  const PASSAGES = [
    { text: "今天的风有点温柔，路过街角的面包店，香味追了我半条街。我想把这个瞬间存起来，等你回来的时候，讲给你听。", key: "温柔" },
    { text: "晚上好，欢迎收听今夜的电台。如果你还没睡，就让这首歌陪你一会儿吧。窗外的城市还亮着灯，而你并不孤单。", key: "晚上好" },
    { text: "我从来不怕走慢一点的路，因为路上有云，有树，有偶尔停下来的猫。慢慢来，比较快，这是我最喜欢的一句话。", key: "慢慢来" },
    { text: "春天的第一场雨落下来的时候，整座城市都安静了。我撑着伞站在桥上，听见雨点轻轻敲着湖面，像在弹琴。", key: "安静" },
    { text: "早上好呀！今天也是元气满满的一天，记得吃早饭，记得多喝水，也记得对镜子里的自己笑一笑。", key: "早上好呀" }
  ];

  // 六个评分维度（权重合计 1）
  const DIMS = [
    { key: "timbre",     name: "音色质感", en: "TIMBRE",    w: 0.22, hint: "声音干净度、圆润度与颗粒感" },
    { key: "resonance",  name: "共鸣磁性", en: "RESONANCE", w: 0.18, hint: "胸腔与口腔共鸣带来的厚度" },
    { key: "clarity",    name: "清晰明亮", en: "CLARITY",   w: 0.16, hint: "咬字清楚程度与声音亮度" },
    { key: "expressive", name: "情绪感染", en: "EMOTION",   w: 0.16, hint: "语调起伏与情绪传递" },
    { key: "rhythm",     name: "节奏韵律", en: "RHYTHM",    w: 0.12, hint: "语速、停顿与呼吸节奏" },
    { key: "unique",     name: "声音辨识", en: "SIGNATURE", w: 0.16, hint: "一开口就被认出来的程度" }
  ];

  // 段位：用名字代替"超过 xx% 的人"，不编造统计数据
  const TIERS = [
    { min: 95, name: "天籁级" },
    { min: 90, name: "殿堂级" },
    { min: 85, name: "耳朵怀孕级" },
    { min: 80, name: "宝藏声线级" },
    { min: 0,  name: "潜力新声级" }
  ];

  // 声线类型库
  // proto：本地引擎的原型特征 f0=典型基频(Hz) bright/breath/expr/speed 为 0-1
  // stars：稀有度（娱乐向主观设定，上线后可按真实分布调整）
  const TYPES = {
    qingleng_shaonian: {
      name: "清冷少年音", tagline: "干净利落，带一点点距离感",
      desc: "像冬天早晨的空气，清澈、克制，越听越上头。",
      deep: "#12434F", light: "#BFE3E6", stars: 4, age: [18, 24],
      proto: { f0: 155, bright: .7, breath: .3, expr: .3, speed: .5 },
      keywords: ["冬日清晨", "薄荷感", "少年气", "克制", "清澈"],
      careers: ["动画配音", "广播剧主役", "纪录片旁白"],
      scenes: ["广播剧", "睡前故事", "游戏角色语音"],
      song: "清新民谣 / 日系流行",
      share: ["清冷是你的底色，温柔是你的彩蛋", "一开口，空气都安静了"]
    },
    wenrun_gongzi: {
      name: "温润公子音", tagline: "温和圆润，听着就安心",
      desc: "说话像一杯温度刚好的茶，不急不躁，让人想一直听下去。",
      deep: "#3F4A2E", light: "#E3E6C8", stars: 3, age: [24, 30],
      proto: { f0: 135, bright: .45, breath: .35, expr: .45, speed: .45 },
      keywords: ["温茶", "如沐春风", "安心感", "君子气", "圆润"],
      careers: ["有声书主播", "古风广播剧", "品牌旁白"],
      scenes: ["有声小说", "古风配音", "冥想引导"],
      song: "古风 / 慢情歌",
      share: ["你的声音，是一杯刚好的温茶", "温润如玉，说的就是你"]
    },
    dipaopao: {
      name: "低音炮", tagline: "胸腔共鸣，一开口就是重低音",
      desc: "低频厚实得像大提琴，适合在耳边说晚安。",
      deep: "#3A1716", light: "#E7B77A", stars: 4, age: [26, 34],
      proto: { f0: 105, bright: .2, breath: .3, expr: .4, speed: .4 },
      keywords: ["大提琴", "重低音", "安全感", "厚实", "耳边晚安"],
      careers: ["电影预告旁白", "电台主持", "游戏 BOSS 配音"],
      scenes: ["深夜电台", "预告片旁白", "ASMR"],
      song: "R&B / 爵士",
      share: ["低音一开，耳机自动降噪", "被你的声音包围了"]
    },
    cixing_dashu: {
      name: "磁性大叔音", tagline: "成熟的颗粒感，自带故事",
      desc: "有一点沙、一点稳，像老唱片里的旁白。",
      deep: "#2B2420", light: "#D9B98E", stars: 3, age: [30, 40],
      proto: { f0: 120, bright: .35, breath: .6, expr: .5, speed: .45 },
      keywords: ["老唱片", "威士忌", "故事感", "沉稳", "颗粒感"],
      careers: ["纪录片解说", "播客主理人", "广告旁白"],
      scenes: ["纪录片", "播客", "品牌广告"],
      song: "蓝调 / 老情歌",
      share: ["你的声音里，住着一整部电影", "成熟的颗粒感，最难模仿"]
    },
    yansang: {
      name: "烟嗓", tagline: "松弛的沙砾感，耐听又有味道",
      desc: "声音里有风也有火，克制的沙哑最迷人。",
      deep: "#33302E", light: "#E58E5A", stars: 4, age: [24, 32],
      proto: { f0: 150, bright: .3, breath: .85, expr: .45, speed: .45 },
      keywords: ["余烬", "公路电影", "松弛", "沙砾感", "不羁"],
      careers: ["独立歌手", "电台主持", "角色配音"],
      scenes: ["Live House", "公路电影旁白", "深夜播客"],
      song: "摇滚 / 民谣 / Blues",
      share: ["沙哑一点，才有故事", "声音里有风，也有火"]
    },
    yuanqi_shaonv: {
      name: "元气少女音", tagline: "明亮跳跃，自带阳光滤镜",
      desc: "每个字都像在蹦跳，听完心情变好了一个度。",
      deep: "#8A2E1F", light: "#FFD7A8", stars: 3, age: [17, 22],
      proto: { f0: 255, bright: .8, breath: .2, expr: .85, speed: .8 },
      keywords: ["橘子汽水", "晴天", "蹦蹦跳跳", "活力", "能量满格"],
      careers: ["动画配音", "带货主播", "儿童节目主持"],
      scenes: ["Vlog 旁白", "动画配音", "直播"],
      song: "J-Pop / 甜系流行",
      share: ["你的声音自带晴天", "听你说话，电量 +50%"]
    },
    yujie: {
      name: "御姐音", tagline: "从容低稳，气场两米八",
      desc: "不紧不慢的中低音，温柔里带着掌控感。",
      deep: "#3B1230", light: "#F0B8D2", stars: 4, age: [24, 32],
      proto: { f0: 185, bright: .4, breath: .4, expr: .4, speed: .4 },
      keywords: ["红丝绒", "从容", "气场", "高级感", "掌控感"],
      careers: ["广播剧女主", "品牌发言人", "电台主持"],
      scenes: ["广播剧", "品牌发布", "情感电台"],
      song: "R&B / 爵士 / 粤语慢歌",
      share: ["不用大声，气场自然就到了", "温柔，但不好惹"]
    },
    tianruan: {
      name: "奶糖甜软音", tagline: "软糯清甜，尾音会拐弯",
      desc: "像刚化开的奶糖，甜度刚好，不腻。",
      deep: "#7A3349", light: "#FFE0E6", stars: 3, age: [18, 23],
      proto: { f0: 260, bright: .55, breath: .45, expr: .6, speed: .45 },
      keywords: ["草莓牛奶", "棉花糖", "软糯", "治愈", "甜度刚好"],
      careers: ["动画配音", "陪伴类主播", "游戏角色语音"],
      scenes: ["睡前故事", "游戏语音", "陪伴直播"],
      song: "甜系流行 / 动漫歌曲",
      share: ["甜度刚好，一点都不腻", "你的尾音，会拐弯"]
    },
    zhixing_zhubo: {
      name: "知性主播音", tagline: "字正腔圆，清晰又可信",
      desc: "吐字干净、节奏稳，天生适合把话讲清楚。",
      deep: "#1E2B4A", light: "#C9D6F2", stars: 3, age: [24, 30],
      proto: { f0: 200, bright: .6, breath: .15, expr: .5, speed: .55 },
      keywords: ["晨间新闻", "白衬衫", "可信赖", "清晰", "专业感"],
      careers: ["新闻主播", "知识博主", "企业培训讲师"],
      scenes: ["知识类视频", "新闻播报", "课程讲解"],
      song: "流行抒情",
      share: ["你说的话，让人想记笔记", "字正腔圆，是你的天赋"]
    },
    shenye_diantai: {
      name: "深夜电台音", tagline: "慢一点，轻一点，刚好治愈",
      desc: "气息温柔、语速舒缓，像凌晨一点陪你的那盏灯。",
      deep: "#191B3A", light: "#F2D27A", stars: 4, age: [23, 30],
      proto: { f0: 160, bright: .3, breath: .65, expr: .35, speed: .2 },
      keywords: ["凌晨一点", "台灯", "治愈", "耳语", "温柔"],
      careers: ["情感电台主播", "助眠主播", "有声书主播"],
      scenes: ["深夜电台", "助眠音频", "情书朗读"],
      song: "Lo-fi / 慢情歌",
      share: ["适合在凌晨一点被听见", "你的声音，是一盏小台灯"]
    },
    kongling: {
      name: "空灵仙气音", tagline: "高而不尖，轻得像雾",
      desc: "通透轻盈，带着一点不食人间烟火的距离。",
      deep: "#2A3E57", light: "#E6F0FA", stars: 5, age: [18, 25],
      proto: { f0: 280, bright: .75, breath: .55, expr: .35, speed: .35 },
      keywords: ["山间雾", "月光", "仙气", "轻盈", "通透"],
      careers: ["古风歌手", "游戏仙侠角色", "冥想引导师"],
      scenes: ["古风歌曲", "仙侠游戏", "冥想音频"],
      song: "古风 / 新世纪音乐",
      share: ["声音轻得像山间的雾", "仙气不是装的，是天生的"]
    },
    yangguang_qingnian: {
      name: "阳光青年音", tagline: "明亮有劲，像运动场的风",
      desc: "干净又有活力，笑起来声音里都有光。",
      deep: "#1F4D2E", light: "#F4E27A", stars: 2, age: [19, 26],
      proto: { f0: 150, bright: .7, breath: .2, expr: .75, speed: .7 },
      keywords: ["夏日球场", "白 T 恤", "元气", "明亮", "少年感"],
      careers: ["体育解说", "活动主持", "Vlog 博主"],
      scenes: ["运动解说", "Vlog", "校园广播"],
      song: "流行摇滚 / 青春流行",
      share: ["你的声音，有夏天的味道", "笑起来，声音里都有光"]
    },
    lanyang_qipao: {
      name: "慵懒气泡音", tagline: "松弛低能量，懒得很高级",
      desc: "不费力的松弛感，像周末午后半睡半醒。",
      deep: "#3A3346", light: "#CDB8F0", stars: 4, age: [22, 30],
      proto: { f0: 140, bright: .25, breath: .7, expr: .25, speed: .25 },
      keywords: ["周末午后", "猫", "松弛感", "慵懒", "不费力"],
      careers: ["ASMR 主播", "Lo-fi 歌手", "播客主理人"],
      scenes: ["ASMR", "午后播客", "Lo-fi 歌曲"],
      song: "Lo-fi / City Pop",
      share: ["松弛感，是你声音的出厂设置", "懒懒的，但很好听"]
    },
    linjia_qingtian: {
      name: "邻家清甜音", tagline: "自然清甜，亲切不做作",
      desc: "像清晨的柠檬水，清爽亲切，毫不费力。",
      deep: "#2F5D50", light: "#F6EDC9", stars: 2, age: [20, 26],
      proto: { f0: 225, bright: .6, breath: .3, expr: .55, speed: .55 },
      keywords: ["柠檬水", "白裙子", "亲切", "清甜", "自然"],
      careers: ["生活类博主", "品牌种草主播", "有声书主播"],
      scenes: ["生活 Vlog", "好物分享", "温暖故事"],
      song: "清新流行 / 民谣",
      share: ["像清晨的柠檬水，刚刚好", "亲切，是最难得的好听"]
    }
  };

  // 维度点评素材（本地引擎）：[高分, 中分, 一般]
  const DIM_COMMENTS = {
    timbre:     ["音色干净通透，几乎没有毛刺感", "音色圆润自然，听感很舒服", "音色朴素真实，有自己的味道"],
    resonance:  ["共鸣饱满，低频厚度很加分", "共鸣位置稳定，声音不发飘", "声音偏轻盈，共鸣还有空间"],
    clarity:    ["咬字清楚，亮度刚好不刺耳", "字头清晰，听起来很利落", "声音偏柔，字尾可以再收紧"],
    expressive: ["语调起伏大，情绪很有画面感", "语气自然有温度，不平铺直叙", "情绪克制内敛，属于耐听型"],
    rhythm:     ["语速从容，停顿恰到好处", "节奏平稳，呼吸自然", "节奏有个性，停顿可再匀一点"],
    unique:     ["辨识度很高，听一次就记住了", "有自己的声音签名，不撞音", "声音亲切耐听，越听越熟悉"]
  };

  const TIPS = {
    timbre: "朗读前打个哈欠放松喉咙，音色会更圆润。",
    resonance: "试着把声音往胸口“放”，像对着瓮说话，共鸣会更厚。",
    clarity: "嘴角微微上提，字头咬得利落一点，清晰度马上提升。",
    expressive: "读到关键词时轻轻放慢或加重，情绪就出来了。",
    rhythm: "在逗号处留半拍呼吸，节奏会更从容。",
    unique: "放大你习惯的尾音和语气词，那就是你的声音签名。"
  };

  return { PASSAGES, DIMS, TIERS, TYPES, DIM_COMMENTS, TIPS };
})();
