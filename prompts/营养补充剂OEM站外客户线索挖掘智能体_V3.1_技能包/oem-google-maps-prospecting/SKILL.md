---
name: oem-google-maps-prospecting
description: 用谷歌地图寻找可能做自有品牌补充剂的线下渠道（连锁健身房、诊所、药房、健康食品店）和区域进口批发商。执行C渠道任务时使用。优先调用Accio官方谷歌地图获客技能或Places API，按“城市×关键词”检索，到官网确认有没有自有品牌，输出候选表。
---

# S04 谷歌地图渠道商挖掘

## 目标
用谷歌地图找到可能做自有品牌补充剂的线下渠道（T4）和区域进口批发商（T5）。

## 输入
S01 的任务（国家 × 城市 × 关键词）、run_config 中 T4 / T5 是否开启、我方 MOQ、线索总库、排除名单。

## 步骤
1. 采集工具的优先顺序：Accio 官方的谷歌地图获客技能 → Google Places API（需要预算授权）→ 浏览器手动检索（每个“城市 × 关键词”最多看前 40 条）。
2. 关键词使用目标国的语言：
   - T4：supplement store、vitamin store、health food store、gym、fitness center、chiropractor、naturopath、functional medicine clinic、med spa、weight loss clinic、pharmacy；
   - T5：supplement distributor、supplement wholesaler、nutrition distributor、health products importer。
3. 记录：名称、类别、地址、电话、网站、评分、评论数、营业状态、最近一条评论的日期、地图链接；商家信息里有 WhatsApp 的一并记录。
4. 初筛：必须有官网；排除标为“永久停业”或“暂时停业”的、没有公司主体的个人工作室、同行工厂。T4 优先有 3 家以上门店的连锁，或评论数排在前 20% 的商家。
5. 打开官网判断：已有自有品牌补充剂的，说明已在委托生产；没有自有品牌但规模较大的，列为“潜在自有品牌客户”；T5 看代理的品牌和覆盖区域。
6. 对照线索总库去重后，交给 S08 做第一轮背调。我方 MOQ 不支持小批量时，T4 只保留大型连锁。

## 输出
候选表：名称｜类型（T4 子类 / T5）｜城市和国家｜门店数｜评分、评论数、最近评论日期｜官网｜是否有自有品牌（及证据）｜地图上的电话和 WhatsApp｜地图链接｜查看日期。

## 规则
遵守谷歌地图的服务条款，不大规模抓取；不打电话，也不发 WhatsApp。
