/** 年齢を年代に丸める（AI送信時の匿名化用） */
export function toAgeRange(age: number): string {
  if (age < 10) return "10歳未満";
  const decade = Math.floor(age / 10) * 10;
  return `${decade}代`;
}
