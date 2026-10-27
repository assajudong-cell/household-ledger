// 가맹점 이름으로 카테고리를 추측한다.
// 순서: 사용자가 고친 규칙(merchantRules) → 기본 키워드 → null(분류 필요)

import { normalizeMerchant } from './parser.js';

const KEYWORDS = [
  ['카페·간식', ['스타벅스', '투썸', '이디야', '메가커피', '메가엠지씨', '컴포즈', '빽다방', '할리스', '폴바셋', '커피', '카페', '배스킨', '던킨', '파리바게뜨', '뚜레쥬르', '베이커리', '설빙']],
  ['장보기', ['이마트', '홈플러스', '롯데마트', '코스트코', '트레이더스', '마트', '하나로', '컬리', '쿠팡프레시', '오아시스', '식자재', '정육', '농협', '청과']],
  ['생활용품', ['다이소', '올리브영', '이케아', '생활', '세탁']],
  ['식비', ['배달의민족', '배민', '요기요', '쿠팡이츠', '맥도날드', '버거킹', '롯데리아', 'kfc', '김밥', '식당', '치킨', '피자', '국밥', '분식', '고기', '횟집', '반점', '초밥', '도시락']],
  ['교통', ['택시', '카카오t', '티머니', '코레일', 'srt', '고속버스', '지하철', '버스', '타다', '쏘카', '따릉이']],
  ['주유·차량', ['주유', 'sk에너지', 'gs칼텍스', 's-oil', '에쓰오일', '현대오일', '오일뱅크', '충전소', '세차', '정비', '하이패스', '주차', '타이어']],
  ['의료', ['병원', '의원', '약국', '치과', '한의원', '안과', '피부과', '소아과', '내과', '정형외과', '검진']],
  ['교육', ['학원', '교육', '서점', '교보문고', '영풍문고', '예스24', '알라딘', '학습지', '어린이집', '유치원']],
  ['쇼핑·의류', ['쿠팡', '11번가', 'g마켓', '옥션', '네이버페이', '무신사', '지그재그', '유니클로', '자라', '백화점', '아울렛', '신세계', '현대백화점']],
  ['문화·여가', ['cgv', '메가박스', '롯데시네마', '영화', '노래', 'pc방', '볼링', '헬스', '필라테스', '요가', '골프', '티켓', '인터파크', '놀이']],
  ['여행', ['호텔', '모텔', '펜션', '리조트', '에어비앤비', 'airbnb', '야놀자', '여기어때', '항공', '대한항공', '아시아나', '제주항공', '아고다', 'agoda', 'booking']],
  ['구독·통신', ['netflix', '넷플릭스', 'youtube', '유튜브', 'spotify', '멜론', '디즈니', '티빙', '웨이브', '쿠팡와우', 'skt', 'kt ', 'lg유플러스', 'apple.com', 'google', '클라우드']],
  ['주거·공과금', ['관리비', '전기', '가스', '수도', '한국전력', '도시가스', '아파트']],
];

// 편의점은 별도 카테고리 없이 카페·간식으로
const CONVENIENCE = ['gs25', 'cu ', 'cu(', '세븐일레븐', '이마트24', '미니스톱', '편의점'];

export function guessCategory(merchant, merchantRules = {}) {
  if (!merchant) return { name: null, source: null };
  const key = normalizeMerchant(merchant);
  const ruleKey = merchantRuleKey(merchant);
  if (merchantRules[ruleKey] || merchantRules[key]) return { name: merchantRules[ruleKey] || merchantRules[key], source: 'rule' };
  const lower = merchant.toLowerCase() + ' ';
  if (CONVENIENCE.some(k => lower.includes(k))) return { name: '카페·간식', source: 'keyword' };
  for (const [name, words] of KEYWORDS) {
    if (words.some(w => lower.includes(w) || key.includes(normalizeMerchant(w)))) return { name, source: 'keyword' };
  }
  return { name: null, source: null };
}

// 사용자가 카테고리를 고칠 때 규칙 키로 쓰는 값 (지점명 차이를 줄이려고 '점'으로 끝나는 지점명은 앞부분만)
export function merchantRuleKey(merchant) {
  const n = normalizeMerchant(merchant);
  const m = n.match(/^(.+)[가-힣]{2,3}점$/);
  return m && m[1].length >= 2 ? m[1] : n;
}
