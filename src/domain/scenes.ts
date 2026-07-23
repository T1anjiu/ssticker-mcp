import type { SceneDefinition } from "./types.js";

export const SCENES: SceneDefinition[] = [
  scene("greeting", "问候", "Greeting", ["你好", "早上好", "嗨", "哈喽", "在吗"], ["hello", "hi", "hey", "good morning"], ["goodbye"], ["cute", "wholesome"], 0.35),
  scene("goodbye", "告别", "Goodbye", ["再见", "回头见", "先走了", "拜拜"], ["goodbye", "bye", "see you", "later"], [], ["cute", "wholesome"], 0.35),
  scene("goodnight", "晚安", "Good night", ["晚安", "睡了", "做个好梦"], ["good night", "sleep well", "sweet dreams"], [], ["cute", "wholesome"], 0.3),
  scene("thanks", "感谢", "Thanks", ["谢谢", "感谢", "辛苦了", "多谢"], ["thanks", "thank you", "appreciate"], [], ["wholesome", "cute"], 0.4),
  scene("apology", "道歉", "Apology", ["对不起", "抱歉", "不好意思", "我的错"], ["sorry", "apologize", "my bad"], [], ["wholesome"], 0.4),
  scene("acknowledge", "收到", "Acknowledge", ["收到", "知道了", "明白", "好的", "行"], ["got it", "noted", "okay", "understood"], [], ["deadpan"], 0.25),
  scene("joy", "开心", "Joy", ["开心", "高兴", "太好了", "爽", "好耶"], ["happy", "glad", "great", "awesome"], [], ["cute", "wholesome"], 0.65),
  scene("laughter", "大笑", "Laughter", ["哈哈", "笑死", "绷不住", "乐", "太逗了"], ["haha", "lol", "lmao", "funny", "hilarious"], [], ["meme", "cute"], 0.7),
  scene("excitement", "兴奋", "Excitement", ["激动", "冲", "起飞", "迫不及待"], ["excited", "can't wait", "let's go"], [], ["meme", "cute"], 0.8),
  scene("celebration", "庆祝", "Celebration", ["恭喜", "庆祝", "成功了", "赢了", "生日快乐"], ["congrats", "celebrate", "we won", "happy birthday"], [], ["wholesome", "meme"], 0.8),
  scene("praise", "夸赞", "Praise", ["厉害", "牛", "真棒", "优秀", "绝了"], ["amazing", "well done", "brilliant", "nice work"], [], ["wholesome", "meme"], 0.65),
  scene("affection", "喜爱", "Affection", ["喜欢", "爱你", "可爱", "想你"], ["love you", "adorable", "miss you", "cute"], [], ["cute", "wholesome"], 0.55),
  scene("agreement", "赞同", "Agreement", ["同意", "确实", "没错", "可以", "赞成"], ["agree", "exactly", "true", "absolutely"], [], ["deadpan"], 0.35),
  scene("surprise", "惊讶", "Surprise", ["居然", "天啊", "不会吧", "震惊", "什么"], ["wow", "what", "no way", "surprised"], [], ["meme"], 0.75),
  scene("disbelief", "难以置信", "Disbelief", ["真的假的", "我不信", "离谱", "开什么玩笑"], ["seriously", "I don't believe", "unreal", "ridiculous"], [], ["meme", "deadpan"], 0.7),
  scene("confusion", "困惑", "Confusion", ["不懂", "没看懂", "什么意思", "为什么", "迷惑"], ["confused", "don't understand", "what do you mean", "why"], [], ["deadpan", "meme"], 0.5),
  scene("embarrassment", "尴尬", "Embarrassment", ["尴尬", "社死", "脚趾抠地", "丢人"], ["awkward", "embarrassed", "cringe"], [], ["meme", "cute"], 0.65),
  scene("teasing", "调侃", "Teasing", ["笑你", "又来", "就这", "懂的都懂"], ["teasing", "here we go", "sure you did"], ["认真", "serious"], ["sarcastic", "meme"], 0.6),
  scene("refusal", "拒绝", "Refusal", ["不要", "不行", "拒绝", "达咩", "没门"], ["nope", "no way", "refuse", "not happening"], [], ["deadpan", "cute"], 0.55),
  scene("waiting_urging", "等待催促", "Waiting or urging", ["快点", "等你", "还没好吗", "搞快点"], ["hurry", "waiting", "are we there yet"], [], ["meme", "deadpan"], 0.55),
  scene("helpless", "无奈", "Helpless", ["无语", "没办法", "随便吧", "服了"], ["speechless", "whatever", "can't help it"], [], ["deadpan", "meme"], 0.55),
  scene("tired", "疲惫", "Tired", ["累死", "困", "没电了", "想躺"], ["tired", "sleepy", "exhausted", "need rest"], [], ["cute", "deadpan"], 0.55),
  scene("frustration", "烦躁", "Frustration", ["烦", "崩溃", "受不了", "麻了"], ["frustrated", "annoyed", "can't take this"], [], ["meme", "deadpan"], 0.7),
  scene("anger", "生气", "Anger", ["生气", "气死", "火大", "滚"], ["angry", "furious", "mad"], ["威胁", "杀"], ["meme", "deadpan"], 0.8),
  scene("sadness", "难过", "Sadness", ["难过", "伤心", "想哭", "失落"], ["sad", "upset", "crying", "down"], ["去世", "自杀", "急救"], ["wholesome"], 0.55),
  scene("comfort", "安慰", "Comfort", ["抱抱", "会好起来", "别难过", "陪你"], ["hug", "it will be okay", "here for you"], [], ["wholesome", "cute"], 0.4),
  scene("encouragement", "鼓励", "Encouragement", ["加油", "你可以", "坚持", "相信你"], ["you can do it", "keep going", "believe in you"], [], ["wholesome", "cute"], 0.55)
];

export const SERIOUS_PATTERNS: RegExp[] = [
  /自杀|自残|不想活|结束生命|suicid|self[- ]?harm/i,
  /急救|报警|失踪|火灾|地震|车祸|emergency|call 911|ambulance/i,
  /去世|离世|葬礼|癌症晚期|died|death|funeral|terminal cancer/i,
  /律师|法院|判刑|巨额债务|破产|lawsuit|sentenced|bankrupt/i,
  /杀了你|弄死|炸死|暴力威胁|kill you|death threat/i,
  /未成年.{0,40}(性|裸)|minor.{0,40}(sex|nude)/i,
  /仇恨|种族灭绝|hate crime|genocide/i
];

export const EXPLICIT_STICKER_PATTERNS: RegExp[] = [
  /表情包|表情图|发个表情|来个表情|贴纸/i,
  /send (a )?(sticker|meme|reaction)|give me (a )?(sticker|meme)/i
];

export const REDACTION_PATTERNS: Array<[RegExp, string]> = [
  [/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[email]"],
  [/(?<!\d)(?:\+?\d[\d -]{8,}\d)(?!\d)/g, "[phone]"],
  [/\b(?:sk|api|token)[-_][A-Za-z0-9_-]{16,}\b/gi, "[token]"]
];

export function redactSensitiveText(value: string): string {
  return REDACTION_PATTERNS.reduce((text, [pattern, replacement]) => text.replace(pattern, replacement), value);
}

function scene(
  id: string,
  label_zh: string,
  label_en: string,
  keywords_zh: string[],
  keywords_en: string[],
  negative_keywords: string[],
  default_tones: string[],
  default_intensity: number
): SceneDefinition {
  return {
    id,
    label_zh,
    label_en,
    description_zh: `${label_zh}相关的轻量对话反应`,
    description_en: `A lightweight conversational reaction for ${label_en.toLowerCase()}`,
    keywords_zh,
    keywords_en,
    negative_keywords,
    default_tones,
    default_intensity
  };
}
