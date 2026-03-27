export const starterQuizTemplate = `meta:
  slug: mc-whitelist
  title: Q-gate Access Exam
  subtitle: 新人准入测验
  description: 面向 Q-gate Minecraft 服务器与社区审核的基础答题体验。
  passScore: 70
  durationSec: 900
  shuffleQuestions: true
  examMode: closed_book
  requireFullscreen: false
  selectionMode: random
  drawCount: 4
  drawSingleCount: 2
  drawMultipleCount: 1
  drawTextCount: 1
questions:
  - id: rule_01
    type: single
    group: objective
    points: 20
    prompt: 在主城展示建筑区域，哪种行为最不合规？
    options:
      - key: A
        text: 使用领地插件圈地后再施工
      - key: B
        text: 先阅读建筑区告示牌
      - key: C
        text: 未经说明直接爆破旧建筑
      - key: D
        text: 在公共仓库登记材料借用
    answer:
      - C
  - id: rule_02
    type: multiple
    group: objective
    points: 20
    prompt: 以下哪些做法通常有助于通过社区审核？
    options:
      - key: A
        text: 回答时使用清晰、完整的句子
      - key: B
        text: 随意复制别人的答案
      - key: C
        text: 如实填写自己的游戏名与联系方式
      - key: D
        text: 阅读服规后再作答
    answer:
      - A
      - C
      - D
  - id: rule_03
    type: text
    group: subjective
    inputStyle: essay
    points: 30
    prompt: 请简要说明如果你和其他玩家产生争议，你会如何处理？
    placeholder: 20 到 120 字，尽量明确。
    answer:
      - 先沟通
      - 联系管理员
      - 提供证据
  - id: rule_04
    type: single
    group: objective
    points: 15
    prompt: 你需要把通过答题获得的验证码交给谁来验证？
    options:
      - key: A
        text: 任意路过玩家
      - key: B
        text: 群内负责审核的 bot
      - key: C
        text: 地图里的告示牌
      - key: D
        text: 服务器资源包
    answer:
      - B
  - id: rule_05
    type: single
    group: objective
    points: 15
    prompt: 服务器规则中，遇到不确定条目时更稳妥的做法是什么？
    media:
      type: image
      url: https://photo.yrrlyb.top/api.php?sort=pc
      caption: 示例图片题
    options:
      - key: A
        text: 自己猜一个差不多的结论
      - key: B
        text: 询问管理员或查阅公告
      - key: C
        text: 跳过所有规则直接开始玩
      - key: D
        text: 跟着别人乱做
    answer:
      - B
`;



