import { Mark } from "marks-pane";

const SVG_NS = "http://www.w3.org/2000/svg";

const DEFAULT_STYLE = {
	color: "#111827",
	type: "brush", // brush | highlighter | spring | dotwave
	width: 2,
	offset: 2,
};

const LINE_TYPES = ["brush", "highlighter", "spring", "dotwave"];

let filterSequence = 0;

function createSvg(name) {
	return document.createElementNS(SVG_NS, name);
}

function round2(value) {
	return Math.round(value * 100) / 100;
}

function normalizeStyle(style) {
	const normalized = Object.assign({}, DEFAULT_STYLE, style || {});
	normalized.width = Math.max(1, Number(normalized.width) || DEFAULT_STYLE.width);
	normalized.offset = Math.max(1, Number(normalized.offset) || DEFAULT_STYLE.offset);
	if (LINE_TYPES.indexOf(normalized.type) === -1) {
		normalized.type = DEFAULT_STYLE.type;
	}
	return normalized;
}

function setStrokeCommon(path, color, width, linecap) {
	path.setAttribute("fill", "none");
	path.setAttribute("stroke", color);
	path.setAttribute("stroke-width", round2(width));
	if (linecap) {
		path.setAttribute("stroke-linecap", linecap);
	}
	return path;
}

// 手绘感的轻微 S 形底形，供毛笔/油画质感使用（质感主要由位移滤镜提供）。
function brushPath(x1, x2, y, amplitude) {
	const total = x2 - x1;
	if (total <= 0) {
		return "";
	}

	const mid = (x1 + x2) / 2;
	const controlX = x1 + total * 0.25;
	return `M ${round2(x1)} ${round2(y)} Q ${round2(controlX)} ${round2(y - amplitude)} ${round2(mid)} ${round2(y)} T ${round2(x2)} ${round2(y)}`;
}

// 平滑正弦波路径，用于虚线圆点浪花的底形。
function wavePath(x1, x2, y, amplitude, wavelength) {
	const total = x2 - x1;
	if (total <= 0) {
		return "";
	}

	const count = Math.max(1, Math.round(total / wavelength));
	const segment = total / count;

	let d = `M ${round2(x1)} ${round2(y)}`;
	for (let i = 0; i < count; i++) {
		const cx = x1 + segment * (i + 0.5);
		const endX = x1 + segment * (i + 1);
		const direction = i % 2 === 0 ? amplitude : -amplitude;
		d += ` Q ${round2(cx)} ${round2(y + direction)} ${round2(endX)} ${round2(y)}`;
	}
	return d;
}

/**
 * SVG 下划线标记：不包裹正文 DOM，仅在同一 SVG 覆盖层上按选区矩形逐段绘制。
 * 与 marks-pane 的 Pane 配合，保留容器定位、resize 重绘与鼠标事件代理等底层能力。
 *
 * 四种风格参考 svg_artistic_underline_generator：
 * - brush:       毛笔/油画质感（feTurbulence + feDisplacementMap 抖动）
 * - highlighter: 荧光/马克笔涂抹（粗描边 + 半透明 + multiply）
 * - spring:      连续圈圈弹簧（周期性三次贝塞尔线圈）
 * - dotwave:     虚线圆点浪花（波浪路径 + 圆点 dasharray）
 */
export class Underline extends Mark {

	constructor(range, className, data, style) {
		super();
		this.range = range;
		this.className = className;
		this.data = data || {};
		this.style = normalizeStyle(style);
		this.brushFilterId = null;
	}

	bind(element, container) {
		super.bind(element, container);

		if (this.data) {
			for (const key in this.data) {
				if (Object.prototype.hasOwnProperty.call(this.data, key)) {
					this.element.dataset[key] = this.data[key];
				}
			}
		}

		if (this.className) {
			this.element.classList.add(this.className);
		}

		// 弹簧等风格会越过文本基线向下延展，需允许覆盖层溢出裁剪区域。
		const svgRoot = this.element.ownerSVGElement;
		if (svgRoot) {
			svgRoot.style.overflow = "visible";
		}
	}

	render() {
		// 清空旧图形
		while (this.element.firstChild) {
			this.element.removeChild(this.element.firstChild);
		}

		const docFrag = this.element.ownerDocument.createDocumentFragment();
		const filtered = this.filteredRanges();
		const offset = this.element.getBoundingClientRect();
		const container = this.container.getBoundingClientRect();

		if (this.style.type === "brush") {
			docFrag.appendChild(this.renderBrushFilter());
		}

		for (let i = 0, len = filtered.length; i < len; i++) {
			const r = filtered[i];
			const x = r.left - offset.left + container.left;
			const y = r.top - offset.top + container.top;

			// 透明占位矩形：覆盖整段文本区域，作为点击/右键的命中面（细线下划线本身命中面过小）
			const hit = createSvg("rect");
			hit.setAttribute("x", x);
			hit.setAttribute("y", y);
			hit.setAttribute("width", r.width);
			hit.setAttribute("height", r.height);
			hit.setAttribute("fill", "transparent");
			docFrag.appendChild(hit);

			docFrag.appendChild(this.renderStroke(x, x + r.width, y + r.height - this.style.offset, r.height));
		}

		this.element.appendChild(docFrag);
	}

	renderStroke(x1, x2, y, height) {
		const { color, type, width } = this.style;

		switch (type) {
			case "highlighter":
				return this.renderHighlighter(x1, x2, y, color, width);
			case "spring":
				return this.renderSpring(x1, x2, y, height, color, width);
			case "dotwave":
				return this.renderDotWave(x1, x2, y, height, color, width);
			case "brush":
			default:
				return this.renderBrush(x1, x2, y, color, width);
		}
	}

	renderBrush(x1, x2, y, color, width) {
		const strokeWidth = Math.max(width * 2, 6);
		const amplitude = Math.max(2, width * 0.6);
		const path = createSvg("path");
		path.setAttribute("d", brushPath(x1, x2, y, amplitude));
		setStrokeCommon(path, color, strokeWidth, "square");
		path.setAttribute("filter", `url(#${this.brushFilterId})`);
		return path;
	}

	renderBrushFilter() {
		if (!this.brushFilterId) {
			this.brushFilterId = `bookmark-underline-brush-filter-${filterSequence++}`;
		}

		const defs = createSvg("defs");
		const filter = createSvg("filter");
		filter.setAttribute("id", this.brushFilterId);
		filter.setAttribute("x", "-50%");
		filter.setAttribute("y", "-50%");
		filter.setAttribute("width", "200%");
		filter.setAttribute("height", "200%");

		const turbulence = createSvg("feTurbulence");
		turbulence.setAttribute("type", "fractalNoise");
		turbulence.setAttribute("baseFrequency", "0.05");
		turbulence.setAttribute("numOctaves", "4");
		turbulence.setAttribute("result", "noise");

		const displacement = createSvg("feDisplacementMap");
		displacement.setAttribute("in", "SourceGraphic");
		displacement.setAttribute("in2", "noise");
		displacement.setAttribute("scale", round2(this.style.width * 1.5));
		displacement.setAttribute("xChannelSelector", "R");
		displacement.setAttribute("yChannelSelector", "G");

		filter.appendChild(turbulence);
		filter.appendChild(displacement);
		defs.appendChild(filter);
		return defs;
	}

	renderHighlighter(x1, x2, y, color, width) {
		const strokeWidth = Math.max(width * 3.5, 12);
		// 轻微斜度让涂抹更接近手绘马克笔
		const slant = Math.min(3, Math.max(1, (x2 - x1) * 0.01));
		const path = createSvg("path");
		path.setAttribute("d", `M ${round2(x1)} ${round2(y)} L ${round2(x2)} ${round2(y - slant)}`);
		setStrokeCommon(path, color, strokeWidth, "round");
		path.setAttribute("opacity", "0.45");
		path.setAttribute("style", "mix-blend-mode: multiply;");
		return path;
	}

	renderSpring(x1, x2, y, height, color, width) {
		const total = x2 - x1;
		const path = createSvg("path");
		if (total <= 0) {
			return path;
		}

		// 波长与振幅适当增大，线圈中心上移、更贴近文本基线
		const period = Math.max(16, height * 0.8);
		const up = Math.max(5, height * 0.32);
		const down = Math.max(5, height * 0.28);
		const centerY = y + Math.max(1, height * 0.05);
		const count = Math.max(1, Math.round(total / period));
		const segment = total / count;

		let d = `M ${round2(x1)} ${round2(centerY)}`;
		for (let i = 0; i < count; i++) {
			const sx = x1 + segment * i;
			const ex = x1 + segment * (i + 1);
			const c1x = sx + segment * 0.375;
			const c2x = sx + segment * 0.625;
			d += ` C ${round2(c1x)} ${round2(centerY - up)} ${round2(c2x)} ${round2(centerY + down)} ${round2(ex)} ${round2(centerY)}`;
		}

		path.setAttribute("d", d);
		setStrokeCommon(path, color, width, "round");
		return path;
	}

	renderDotWave(x1, x2, y, height, color, width) {
		const strokeWidth = Math.max(width * 1.5, 4);
		const amplitude = Math.max(1.5, height * 0.08);
		const total = x2 - x1;
		// 波长较大增加：整段约 1-2 个平缓浪花
		const wavelength = Math.max(60, total * 0.6);
		const gap = Math.max(6, strokeWidth * 2.2);
		const path = createSvg("path");
		path.setAttribute("d", wavePath(x1, x2, y, amplitude, wavelength));
		setStrokeCommon(path, color, strokeWidth, "round");
		path.setAttribute("stroke-dasharray", `1 ${round2(gap)}`);
		return path;
	}

}
