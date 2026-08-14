import { Mark } from "marks-pane";

const SVG_NS = "http://www.w3.org/2000/svg";

const DEFAULT_STYLE = {
	color: "#111827",
	type: "straight", // straight | dashed | dotted | wavy
	width: 2,
	offset: 2,
};

const LINE_TYPES = ["straight", "dashed", "dotted", "wavy"];

function createSvg(name) {
	return document.createElementNS(SVG_NS, name);
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

/**
 * SVG 下划线标记：不包裹正文 DOM，仅在同一 SVG 覆盖层上按选区矩形逐段绘制。
 * 与 marks-pane 的 Pane 配合，保留容器定位、resize 重绘与鼠标事件代理等底层能力。
 */
export class Underline extends Mark {

	constructor(range, className, data, style) {
		super();
		this.range = range;
		this.className = className;
		this.data = data || {};
		this.style = normalizeStyle(style);
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

			docFrag.appendChild(this.renderStroke(x, x + r.width, y + r.height - this.style.offset));
		}

		this.element.appendChild(docFrag);
	}

	renderStroke(x1, x2, y) {
		const { color, type, width } = this.style;

		if (type === "wavy") {
			return this.renderWave(x1, x2, y, color, width);
		}

		const line = createSvg("line");
		line.setAttribute("x1", x1);
		line.setAttribute("x2", x2);
		line.setAttribute("y1", y);
		line.setAttribute("y2", y);
		line.setAttribute("stroke", color);
		line.setAttribute("stroke-width", width);

		if (type === "dashed") {
			line.setAttribute("stroke-dasharray", `${6 * width} ${4 * width}`);
			line.setAttribute("stroke-linecap", "square");
		} else if (type === "dotted") {
			line.setAttribute("stroke-dasharray", `0 ${4 * width}`);
			line.setAttribute("stroke-linecap", "round");
		} else {
			line.setAttribute("stroke-linecap", "square");
		}

		return line;
	}

	renderWave(x1, x2, y, color, width) {
		const amplitude = Math.max(1.5, width * 0.8);
		const wavelength = 10;
		const total = x2 - x1;
		const count = Math.max(1, Math.round(total / wavelength));
		const segment = total / count;

		let d = `M ${x1} ${y}`;
		for (let i = 0; i < count; i++) {
			const cx = x1 + segment * (i + 0.5);
			const direction = i % 2 === 0 ? -amplitude : amplitude;
			const endX = x1 + segment * (i + 1);
			d += ` Q ${cx} ${y + direction} ${endX} ${y}`;
		}

		const path = createSvg("path");
		path.setAttribute("d", d);
		path.setAttribute("fill", "none");
		path.setAttribute("stroke", color);
		path.setAttribute("stroke-width", width);
		path.setAttribute("stroke-linecap", "square");
		return path;
	}

}
