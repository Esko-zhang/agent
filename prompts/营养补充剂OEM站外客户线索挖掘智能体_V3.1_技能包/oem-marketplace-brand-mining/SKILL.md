---
name: oem-marketplace-brand-mining
description: 在Amazon、TikTok Shop、Shopify、iHerb、Walmart等电商平台挖掘补充剂私标品牌。执行B渠道任务时使用。按子类目和剂型筛选品牌，通过卖家公示信息、标签上的Manufactured for/Distributed by和原产地确认公司主体与外包证据，找到品牌官网，输出品牌候选表。
---

# S03 电商平台品牌挖掘

## 目标
在 Amazon、TikTok Shop、Shopify、iHerb、Walmart 及次市场平台上，找到销售自有品牌补充剂、剂型与我方匹配的品牌，并确认品牌背后的公司主体和官网。

## 输入
S01 的任务（平台 × 子类目 × 剂型 × 关键词）、产品范围、线索总库、排除名单。

## 步骤
1. 按任务打开列表页：Amazon 用子类目的 Best Sellers / New Releases / Movers & Shakers 或搜索结果；TikTok Shop 用搜索结果和热卖；iHerb 用品牌目录；Shopify 用 Google 搜索结果。每个任务最多看 run_config 规定的页数。
2. 初筛品牌：
   - 排除平台自营品牌、大集团品牌、只转售别家品牌的店铺；
   - 优先评论数 50–5,000、有 3 个以上 SKU、上架不到 6 个月的新品、评论数增长快的品牌；
   - 剂型必须在我方范围内，或者是相邻、可以扩展的剂型。
3. 对入选品牌的 1–2 个代表商品，记录：品牌、平台、商品 URL、剂型、主要成分、价格、评分、评论数、最近一条评论的日期（用于判断是否仍在活跃销售）、上架时间（如能看到）。
4. 确认公司主体：
   a) Amazon 卖家详情页公示的 Business Name 和 Business Address；
   b) 商品图背面标签上的“Manufactured for / Distributed by 公司名，城市，州”；
   c) 原产地：Made in China / Product of China 说明已经在中国采购。
   无法确认时写“未知”，不把店铺名当作法律主体。标签图上看不清的字不要猜。
5. 卖家地址在中国大陆的，标记为 CN_SELLER。
6. 通过 Amazon 品牌旗舰店或 Google 搜索品牌名找到官网。
7. 对照线索总库去重后，交给 S08 做第一轮背调。

## 输出
品牌候选表：品牌｜公司主体（及来源）｜国家｜平台和 URL｜剂型 / 主要成分｜评论数 / 最近评论日期｜外包证据｜原产地｜官网｜标记（T1 / T3 / CN_SELLER）。

## 规则
不使用平台的买家—卖家消息、商品问答或评论区联系任何人；按正常的浏览节奏操作，不批量高速抓取，不绕过验证码。
