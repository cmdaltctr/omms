/** Computed presentation evidence for the synthetic preview, without changing application state. */
export function measurePage() {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 1;
  const context = canvas.getContext("2d", { willReadFrequently: true })!;
  const colour = (value: string): number[] => {
    context.clearRect(0, 0, 1, 1);
    context.fillStyle = value;
    context.fillRect(0, 0, 1, 1);
    return Array.from(context.getImageData(0, 0, 1, 1).data);
  };
  const composite = (front: number[], back: number[]) => {
    const alpha = front[3] / 255;
    return front
      .slice(0, 3)
      .map((channel, index) => channel * alpha + back[index] * (1 - alpha))
      .concat(255);
  };
  const background = (node: Element): number[] => {
    const own = colour(getComputedStyle(node).backgroundColor);
    return composite(
      own,
      node.parentElement ? background(node.parentElement) : [255, 255, 255, 255]
    );
  };
  const luminance = (rgb: number[]) =>
    rgb
      .slice(0, 3)
      .map((channel) => {
        const n = channel / 255;
        return n <= 0.04045 ? n / 12.92 : ((n + 0.055) / 1.055) ** 2.4;
      })
      .reduce((sum, channel, index) => sum + channel * [0.2126, 0.7152, 0.0722][index], 0);
  const contrast = (a: number[], b: number[]) => {
    const [high, low] = [luminance(a), luminance(b)].sort((x, y) => y - x);
    return (high + 0.05) / (low + 0.05);
  };
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  const failures: {
    text: string;
    ratio: number;
    colour: string;
    background: number[];
    className: string;
  }[] = [];
  let measured = 0;
  let minimum = Infinity;
  while (walker.nextNode()) {
    const node = walker.currentNode;
    const element = node.parentElement!;
    if (
      !node.textContent?.trim() ||
      element.closest("script, style, [disabled], [aria-disabled=true], [aria-hidden=true]")
    )
      continue;
    const style = getComputedStyle(element);
    const range = document.createRange();
    range.selectNode(node);
    const rect = range.getBoundingClientRect();
    if (!rect.width || !rect.height || rect.right <= 0 || rect.left >= innerWidth) continue;
    let opacity = 1;
    let hidden = false;
    for (let parent: Element | null = element; parent; parent = parent.parentElement) {
      const s = getComputedStyle(parent);
      opacity *= Number(s.opacity);
      hidden ||= s.visibility !== "visible" || s.display === "none";
    }
    if (hidden || opacity === 0) continue;
    const back = background(element);
    const front = colour(style.color);
    front[3] *= opacity;
    const ratio = contrast(composite(front, back), back);
    const large =
      parseFloat(style.fontSize) >= 24 ||
      (parseFloat(style.fontSize) >= 18.67 && Number(style.fontWeight) >= 700);
    measured++;
    minimum = Math.min(minimum, ratio);
    if (ratio < (large ? 3 : 4.5))
      failures.push({
        text: node.textContent.trim().slice(0, 90),
        ratio,
        colour: style.color,
        background: back,
        className: element.className,
      });
  }
  return {
    path: location.pathname,
    width: innerWidth,
    height: innerHeight,
    lang: document.documentElement.lang,
    dir: document.documentElement.dir,
    dark: document.documentElement.classList.contains("dark"),
    background: getComputedStyle(document.body).backgroundColor,
    font: getComputedStyle(document.body).fontFamily,
    codeFont: document.querySelector("code")
      ? getComputedStyle(document.querySelector("code")!).fontFamily
      : null,
    overflow: document.documentElement.scrollWidth > innerWidth,
    styles: [...document.querySelectorAll("style[data-vite-dev-id]")].map((node) =>
      node.getAttribute("data-vite-dev-id")
    ),
    sections: [...document.querySelectorAll("[id^='settings-section-'], [id^='profile-']")].map(
      (node) => node.id
    ),
    contrast: { measured, minimum, failures },
    fields: [
      ...document.querySelectorAll(
        "input:not([type=checkbox]):not([type=radio]),[role=combobox],textarea"
      ),
    ].map((node) => ({
      height: node.getBoundingClientRect().height,
      fill: getComputedStyle(node).backgroundColor,
      boundaryContrast: contrast(colour(getComputedStyle(node).borderColor), background(node)),
    })),
  };
}
