/**
 * The complete default theme.
 *
 * Every value the renderer can ask for exists here, so a theme file only ever
 * needs to state its differences. The renderer must never contain a colour or a
 * line width of its own (ADR 0012).
 */

/** @type {any} */
export const DEFAULT_THEME = {
  name: 'default',
  description: 'Built-in fallback. Every theme inherits these values.',

  page: {
    background: '#ffffff',
    margin_mm: 600,
    scale_mode: 'fit',
    target_width_px: 1200,
    px_per_mm: 0.05,
    min_px_per_mm: 0.004,
    max_px_per_mm: 0.4,
    font_family: 'Helvetica, Arial, sans-serif',
    title: { show: false, font_size_px: 16, color: '#111111' },
  },

  walls: {
    default: {
      fill: '#2b2b2b',
      fill_opacity: 1,
      stroke: '#000000',
      stroke_width_px: 1,
      dash: '',
      hatch: 'none',
      hatch_color: '#000000',
      hatch_spacing_px: 6,
    },
    by_classification: {
      exterior: { fill: '#2b2b2b' },
      interior: { fill: '#454545' },
      partition: { fill: '#6b6b6b' },
      structural: { fill: '#1a1a1a' },
      retaining: { fill: '#2b2b2b' },
      virtual: { fill: 'none', stroke: '#9e9e9e', dash: '6 4' },
    },
    by_state: {
      existing: {},
      planned: { fill: '#8f8f8f', dash: '8 4' },
      new: { fill: '#20558a' },
      demolish: { fill: 'none', stroke: '#b03a2e', dash: '7 4', stroke_width_px: 1 },
      unknown: { fill: '#9a9a9a', dash: '3 3' },
    },
  },

  openings: {
    door: {
      show_arc: true,
      show_leaf: true,
      arc_stroke: '#707070',
      arc_stroke_width_px: 0.8,
      arc_dash: '',
      leaf_stroke: '#333333',
      leaf_fill: '#ffffff',
      leaf_stroke_width_px: 1,
      leaf_thickness_mm: 40,
      sliding_offset_mm: 60,
      reveal_stroke: '#000000',
      reveal_stroke_width_px: 1,
    },
    window: {
      style: 'double_line',
      stroke: '#333333',
      stroke_width_px: 1,
      fill: '#ffffff',
      frame_ratio: 0.28,
      reveal_stroke: '#000000',
      reveal_stroke_width_px: 1,
    },
    passage: {
      style: 'reveal',
      stroke: '#000000',
      stroke_width_px: 1,
      dash: '',
    },
    generic: {
      style: 'hatched',
      stroke: '#8a8a8a',
      stroke_width_px: 1,
      dash: '4 3',
    },
    by_state: {
      existing: {},
      planned: { dash: '6 3', arc_dash: '6 3' },
      new: { stroke: '#20558a', leaf_stroke: '#20558a', arc_stroke: '#5b87b3' },
      demolish: {
        stroke: '#b03a2e',
        leaf_stroke: '#b03a2e',
        leaf_fill: 'none',
        arc_stroke: '#b03a2e',
        dash: '6 4',
        arc_dash: '4 3',
        opacity: 0.85,
      },
      unknown: {},
    },
  },

  spaces: {
    show_fill: true,
    default: { fill: '#f4f4f4', fill_opacity: 1, stroke: 'none', stroke_width_px: 0 },
    by_category: {
      living: { fill: '#f4f4f4' },
      bedroom: { fill: '#f4f4f4' },
      kitchen: { fill: '#f4f4f4' },
      dining: { fill: '#f4f4f4' },
      bath: { fill: '#eef2f4' },
      wc: { fill: '#eef2f4' },
      hall: { fill: '#f7f7f7' },
      corridor: { fill: '#f7f7f7' },
      office: { fill: '#f4f4f4' },
      storage: { fill: '#f0f0f0' },
      technical: { fill: '#ededed' },
      garage: { fill: '#ebebeb' },
      stairwell: { fill: '#f2f2f2' },
      balcony: { fill: '#fafafa' },
      terrace: { fill: '#fafafa' },
      outdoor: { fill: '#fafafa' },
      other: { fill: '#f4f4f4' },
    },
  },

  labels: {
    show_name: true,
    show_area: true,
    show_id: false,
    name_font_size_px: 13,
    area_font_size_px: 11,
    name_color: '#111111',
    area_color: '#555555',
    name_weight: 'normal',
    name_transform: 'none',
    letter_spacing_px: 0,
    line_gap_px: 4,
    area_decimals: 2,
    area_suffix: ' m²',
    decimal_separator: ',',
    min_label_area_m2: 0.8,
  },

  dimensions: {
    show: true,
    stroke: '#333333',
    stroke_width_px: 0.7,
    font_size_px: 10,
    text_color: '#333333',
    tick_style: 'slash',
    tick_size_px: 5,
    extension_px: 6,
    text_gap_px: 3,
    format: 'm',
    decimals: 2,
  },

  stairs: {
    fill: '#fbfbfb',
    stroke: '#333333',
    stroke_width_px: 1,
    step_stroke: '#666666',
    step_stroke_width_px: 0.7,
    show_arrow: true,
    arrow_color: '#333333',
    arrow_stroke_width_px: 1,
  },

  columns: {
    fill: '#2b2b2b',
    fill_opacity: 1,
    stroke: '#000000',
    stroke_width_px: 1,
    dash: '',
    hatch: 'none',
    hatch_color: '#000000',
    hatch_spacing_px: 6,
  },

  shafts: {
    fill: '#ffffff',
    fill_opacity: 1,
    stroke: '#666666',
    stroke_width_px: 1,
    dash: '4 3',
    hatch: 'diagonal',
    hatch_color: '#bbbbbb',
    hatch_spacing_px: 8,
  },

  annotations: {
    show: true,
    font_size_px: 11,
    color: '#333333',
  },

  uncertainty: {
    mark_estimated: true,
    estimated_prefix: 'ca. ',
    unknown_placeholder: '?',
    estimated_color: '#8a6d3b',
  },
};
