const NORMALIZATION_MAP = {
  "LipIce Sheer Color Fruit Juice": [
    "lipice sheer color fruit juice",
    "sheer color fruit juice"
  ],
  "LipIce Sheer Color Q": [
    "lipice sheer color q",
    "sheer color q"
  ],
  "LipIce Sheer Color": [
    "lipice sheer color",
    "sheer color"
  ],
  "LIPSTICIAN Lip Serum Youth Booster": [
    "lipstician lip serum youth booster",
    "lip serum youth booster"
  ],
  "LIPSTICIAN Lip Serum Rescuer": [
    "lipstician lip serum rescuer",
    "lip serum rescuer"
  ],
  "LIPSTICIAN Lip Serum Protector": [
    "lipstician lip serum protector",
    "lip serum protector"
  ],
  Lipstician: [
    "lipstician",
    "lipice lipstician"
  ],
  "Melty Cream Lip": [
    "melty cream lip",
    "lipice melty cream lip",
    "son duong melty cream lip"
  ],
  "Medi Lip": [
    "medi lip",
    "lipice medi lip",
    "son duong medi lip"
  ],
  "Lip Pure": [
    "lip pure",
    "lipice lip pure",
    "son duong lip pure"
  ],
  "Remos Anti-Itch": [
    "remos anti itch",
    "remos anti-itch",
    "re mos anti itch",
    "ri mot anti itch"
  ],
  "Remos Baby": [
    "remos baby",
    "re mos baby",
    "ri mot baby",
    "remote baby"
  ],
  "Remos IB": [
    "remos ib",
    "re mos ib",
    "ri mot ib",
    "remote ip"
  ],
  Selsun: [
    "selsun",
    "sel sun",
    "sel xanh",
    "seo sun",
    "seo xanh",
    "sao xanh",
    "sau xanh",
    "seu sun",
    "seu xanh",
    "sen xanh",
    "selson",
    "sale xanh",
    "se xanh",
    "sieu xanh"
  ],
  Acnes: [
    "acnes",
    "acknes",
    "ac net",
    "ack net",
    "acnet",
    "ac ne",
    "ack ne",
    "ác nét",
    "ắc nét",
    "ặc nét",
    "Armes",
    "Ars",
    "adware",
    "adnet",
    "Anet",
  ],
  Remos: [
    "remos",
    "re mos",
    "re mot",
    "ri mot",
    "remote"
  ],
  LipIce: [
    "lipice",
    "lip ice",
    "lip icee",
    "lip ai",
    "lip ai xo",
    "lip ai x",
    "liec ai",
    "liec ai ai",
    "lippi",
    "lippi liec ai",
    "lippi liec ai ai",
    "son duong lip ai",
    "son duong liec ai",
    "son duong liec ai ai",
    "son duong lippi liec ai",
    "son duong lippi liec ai ai"
  ]
};

function escapeRegExp(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function buildRule(canonical, aliases) {
  const sortedAliases = [...aliases].sort((left, right) => right.length - left.length);

  return {
    canonical,
    patterns: sortedAliases.map(
      (alias) => new RegExp(`\\b${escapeRegExp(alias)}\\b`, "gi")
    )
  };
}

const NORMALIZATION_RULES = Object.entries(NORMALIZATION_MAP).map(([canonical, aliases]) =>
  buildRule(canonical, aliases)
);

export function normalizeBrandTranscript(text) {
  return NORMALIZATION_RULES.reduce((currentText, rule) => {
    return rule.patterns.reduce((nextText, pattern) => {
      return nextText.replace(pattern, rule.canonical);
    }, currentText);
  }, text);
}

export { NORMALIZATION_MAP };
