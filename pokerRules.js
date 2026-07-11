// pokerRules.js - 扑克游戏牌型识别与大小比较
// 规则：
//  - 点数序(小→大): 2 < 3 < 4 < ... < K < A < 小王 < 大王
//  - 赖子：大小王，可代任何非王牌凑组合；独立单出时大王>小王
//  - 牌型：single / pair / triple / pairs(连对≥2) / plane(飞机≥2) / bomb(≥4)
//  - 禁用：三带、四带、顺子、王炸（两王并出不算炸弹）
//  - 炸弹压一切；同为炸弹先比 size 再比 rank

const RANK_ORDER = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];
const RANK_VALUE = {};
RANK_ORDER.forEach((r, i) => { RANK_VALUE[r] = i; });

const SJ_VALUE = 20;   // 小王单出
const BJ_VALUE = 21;   // 大王单出
const WILD_VALUE = 99; // 赖子独立作为最大牌组的代表值

function isJoker(card) {
  return card && card.suit === 'JOKER';
}

function jokerRank(card) {
  // 返回 'SJ'(小王) 或 'BJ'(大王)
  return card.rank === 'big' ? 'BJ' : 'SJ';
}

function splitJokers(cards) {
  const jokers = cards.filter(isJoker);
  const others = cards.filter(c => !isJoker(c));
  return { jokers, others, jk: jokers.length, ok: others.length };
}

function groupByRank(others) {
  const map = {};
  others.forEach(c => { map[c.rank] = (map[c.rank] || 0) + 1; });
  return map;
}

/**
 * 尝试把 others + jk 张赖子组成 groupCount 个连续点数、每组 groupSize 张
 * 例：连对(size=2, count=2) → 3344；飞机(size=3, count=2) → 222333
 * 规则：A 不能接 2（RANK_ORDER 不循环）
 * @returns {maxRank} 或 null
 */
function tryConsecutive(others, jkTotal, groupCount, groupSize) {
  if (groupCount < 2) return null; // 连对/飞机至少 2 组
  const counts = groupByRank(others);
  let best = null;
  for (let startIdx = 0; startIdx <= RANK_ORDER.length - groupCount; startIdx++) {
    const endIdx = startIdx + groupCount - 1;
    let needJokers = 0;
    let ok = true;
    let usedOthers = 0;
    for (let i = startIdx; i <= endIdx; i++) {
      const r = RANK_ORDER[i];
      const have = counts[r] || 0;
      if (have > groupSize) { ok = false; break; }
      needJokers += (groupSize - have);
      usedOthers += have;
    }
    if (!ok) continue;
    if (needJokers !== jkTotal) continue;
    if (usedOthers !== others.length) continue; // 所有非赖牌都要在区间内
    const maxRank = RANK_ORDER[endIdx];
    if (!best || RANK_VALUE[maxRank] > RANK_VALUE[best]) {
      best = maxRank;
    }
  }
  return best;
}

/**
 * 识别一组牌的牌型
 * @param {Array<{suit,rank,id,...}>} cards
 * @returns {{type,rank,size?}|null}
 *   type: 'single'|'pair'|'triple'|'pairs'|'plane'|'bomb'
 *   rank: 代表点数（'2'~'A' 或 'SJ'/'BJ'/'WILD'）
 *   size: 总张数（仅连对/飞机/炸弹有意义）
 */
function identify(cards) {
  if (!cards || cards.length === 0) return null;
  const n = cards.length;
  const { jokers, others, jk, ok } = splitJokers(cards);

  // ---- 单张 ----
  if (n === 1) {
    if (jk === 1) return { type: 'single', rank: jokerRank(jokers[0]) };
    return { type: 'single', rank: others[0].rank };
  }

  // ---- 炸弹优先（≥4张，全赖子 或 所有非赖同点）----
  if (n >= 4) {
    if (ok === 0) {
      // 全赖子，视为任意最大同点 → WILD
      return { type: 'bomb', rank: 'WILD', size: n };
    }
    if (others.every(c => c.rank === others[0].rank)) {
      return { type: 'bomb', rank: others[0].rank, size: n };
    }
  }

  // ---- 对子（n=2）----
  if (n === 2) {
    if (jk === 2) {
      // 两王并出：按对子处理（可压任何非炸弹对子）
      return { type: 'pair', rank: 'WILD' };
    }
    if (jk === 1 && ok === 1) {
      return { type: 'pair', rank: others[0].rank };
    }
    if (ok === 2 && others[0].rank === others[1].rank) {
      return { type: 'pair', rank: others[0].rank };
    }
    return null;
  }

  // ---- 三张（n=3，非炸弹）----
  if (n === 3) {
    if (ok === 0) return { type: 'triple', rank: 'WILD' };
    if (others.every(c => c.rank === others[0].rank)) {
      return { type: 'triple', rank: others[0].rank };
    }
    if (ok === 2 && jk === 1 && others[0].rank === others[1].rank) {
      return { type: 'triple', rank: others[0].rank };
    }
    if (ok === 1 && jk === 2) {
      return { type: 'triple', rank: others[0].rank };
    }
    return null;
  }

  // ---- 连对（n 偶数，≥4）----
  if (n >= 4 && n % 2 === 0) {
    const pairsCount = n / 2;
    const maxRank = tryConsecutive(others, jk, pairsCount, 2);
    if (maxRank) return { type: 'pairs', rank: maxRank, size: pairsCount };
  }

  // ---- 飞机（n 为 3 倍数，≥6）----
  if (n >= 6 && n % 3 === 0) {
    const triplesCount = n / 3;
    const maxRank = tryConsecutive(others, jk, triplesCount, 3);
    if (maxRank) return { type: 'plane', rank: maxRank, size: triplesCount };
  }

  return null;
}

function rankValue(rank) {
  if (rank === 'SJ') return SJ_VALUE;
  if (rank === 'BJ') return BJ_VALUE;
  if (rank === 'WILD') return WILD_VALUE;
  return RANK_VALUE[rank] ?? -1;
}

/**
 * 判定 newHand 能否打过 lastHand
 * newHand/lastHand 为 identify() 的返回值
 * lastHand 为 null 代表自由出牌
 */
function canBeat(newHand, lastHand) {
  if (!newHand) return false;
  if (!lastHand) return true;
  const newBomb = newHand.type === 'bomb';
  const lastBomb = lastHand.type === 'bomb';
  if (newBomb && !lastBomb) return true;
  if (!newBomb && lastBomb) return false;
  if (newBomb && lastBomb) {
    if (newHand.size !== lastHand.size) return newHand.size > lastHand.size;
    return rankValue(newHand.rank) > rankValue(lastHand.rank);
  }
  if (newHand.type !== lastHand.type) return false;
  if ((newHand.size || 0) !== (lastHand.size || 0)) return false;
  return rankValue(newHand.rank) > rankValue(lastHand.rank);
}

/** 计算这组牌可收割的分数（5 → 5, 10/K → 10） */
function scoreOf(cards) {
  let s = 0;
  cards.forEach(c => {
    if (isJoker(c)) return;
    if (c.rank === '5') s += 5;
    else if (c.rank === '10' || c.rank === 'K') s += 10;
  });
  return s;
}

/** 给人看的牌组描述 */
function describeHand(hand) {
  if (!hand) return '无';
  const typeMap = {
    single: '单张', pair: '对子', triple: '三张',
    pairs: `${hand.size}连对`, plane: `${hand.size}连三(飞机)`, bomb: `${hand.size}星炸弹`
  };
  return typeMap[hand.type] + ' ' + hand.rank;
}

module.exports = {
  identify, canBeat, rankValue, scoreOf, describeHand,
  RANK_ORDER, RANK_VALUE
};
