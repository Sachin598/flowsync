import * as React from 'react';

/** Charts need real layout, which jsdom does not have. Tests care about the data and labels, not the SVG, so charts render their children only. */
const names = ['ResponsiveContainer', 'BarChart', 'LineChart', 'PieChart', 'Bar', 'Line', 'Pie', 'Cell', 'XAxis', 'YAxis', 'CartesianGrid', 'Tooltip', 'Legend'];
export const rechartsMock = Object.fromEntries(
  names.map((n) => [n, ({ children }: { children?: React.ReactNode }) => React.createElement('div', { 'data-chart': n }, children)]),
);
