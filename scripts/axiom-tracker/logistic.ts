export type FeatureSpec = { key: string; label: string; log: boolean }
export type FeatureValues = Record<string, number | null | undefined>
export type Classifier = { means: number[]; scales: number[]; weights: number[]; bias: number; ready: boolean; vectors: number[][] }

const sigmoid = (value: number) => 1 / (1 + Math.exp(-value))

export function median(values: number[]) {
  if (!values.length) return null
  const sorted = values.slice().sort((first, second) => first - second)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2
}

function transform(spec: FeatureSpec, value: number | null | undefined) {
  if (value === null || value === undefined || !Number.isFinite(value)) return null
  return spec.log ? Math.log1p(Math.max(0, value)) : value
}

export function vectorOf(classifier: Pick<Classifier, 'means' | 'scales'>, specs: readonly FeatureSpec[], values: FeatureValues) {
  return specs.map((spec, index) => {
    const value = transform(spec, values[spec.key])
    return value === null ? 0 : (value - classifier.means[index]) / classifier.scales[index]
  })
}

export function chanceOf(classifier: Classifier, vector: number[]) {
  return sigmoid(vector.reduce((total, value, index) => total + value * classifier.weights[index], classifier.bias))
}

export function trainClassifier(specs: readonly FeatureSpec[], rows: FeatureValues[], labels: boolean[], minimum: number): Classifier {
  const columns = specs.map(spec => rows.map(row => transform(spec, row[spec.key])).filter((value): value is number => value !== null))
  const means = columns.map(column => column.length ? column.reduce((total, value) => total + value, 0) / column.length : 0)
  const scales = columns.map((column, index) => {
    if (column.length < 2) return 1
    return Math.sqrt(column.reduce((total, value) => total + (value - means[index]) ** 2, 0) / (column.length - 1)) || 1
  })
  const vectors = rows.map(row => vectorOf({ means, scales }, specs, row))
  const positives = labels.filter(Boolean).length
  const ready = rows.length >= minimum && positives >= 3 && rows.length - positives >= 3
  const weights = new Array<number>(specs.length).fill(0)
  let bias = 0
  if (ready) {
    const rate = 0.15
    const l2 = 0.02
    const positiveWeight = Math.min(8, (rows.length - positives) / positives)
    for (let epoch = 0; epoch < 300; epoch++) {
      const gradient = new Array<number>(specs.length).fill(0)
      let biasGradient = 0
      let total = 0
      for (let row = 0; row < vectors.length; row++) {
        const weight = labels[row] ? positiveWeight : 1
        const error = (sigmoid(vectors[row].reduce((sum, value, index) => sum + value * weights[index], bias)) - (labels[row] ? 1 : 0)) * weight
        for (let index = 0; index < weights.length; index++) gradient[index] += error * vectors[row][index]
        biasGradient += error
        total += weight
      }
      for (let index = 0; index < weights.length; index++) weights[index] -= rate * (gradient[index] / total + l2 * weights[index])
      bias -= rate * biasGradient / total
    }
  }
  return { means, scales, weights, bias, ready, vectors }
}

export function holdoutAccuracy(specs: readonly FeatureSpec[], rows: FeatureValues[], labels: boolean[], minimum: number) {
  if (rows.length < minimum + 10) return null
  const cut = Math.floor(rows.length * 0.8)
  const classifier = trainClassifier(specs, rows.slice(0, cut), labels.slice(0, cut), minimum)
  if (!classifier.ready) return null
  let correct = 0
  let flagged = 0
  let flaggedHits = 0
  for (let row = cut; row < rows.length; row++) {
    const predicted = chanceOf(classifier, vectorOf(classifier, specs, rows[row])) >= 0.5
    if (predicted === labels[row]) correct += 1
    if (predicted) { flagged += 1; if (labels[row]) flaggedHits += 1 }
  }
  return { accuracy: correct / (rows.length - cut), flaggedHitRate: flagged >= 5 ? flaggedHits / flagged : null }
}

export function nearestRows(classifier: Classifier, vector: number[], include: (row: number) => boolean, count = 9) {
  const found: Array<{ row: number; distance: number }> = []
  for (let row = 0; row < classifier.vectors.length; row++) {
    if (!include(row)) continue
    let distance = 0
    for (let index = 0; index < vector.length; index++) distance += (classifier.vectors[row][index] - vector[index]) ** 2
    found.push({ row, distance })
  }
  return found.sort((first, second) => first.distance - second.distance).slice(0, count).map(entry => entry.row)
}

export function topReasons(classifier: Classifier, specs: readonly FeatureSpec[], vector: number[], limit = 4) {
  if (!classifier.ready) return []
  return vector
    .map((value, index) => ({ index, value, contribution: value * classifier.weights[index] }))
    .filter(entry => entry.value !== 0 && Math.abs(entry.contribution) > 0.15)
    .sort((first, second) => Math.abs(second.contribution) - Math.abs(first.contribution))
    .slice(0, limit)
    .map(entry => ({ label: `${entry.value > 0 ? 'High' : 'Low'} ${specs[entry.index].label.toLowerCase()}`, good: entry.contribution > 0 }))
}

export function splitInsights(specs: readonly FeatureSpec[], rows: FeatureValues[], labels: boolean[], outcome: string, limit = 5) {
  const results: Array<{ text: string; strength: number }> = []
  for (const spec of specs) {
    const known = rows.map((row, index) => ({ value: row[spec.key], label: labels[index] })).filter((entry): entry is { value: number; label: boolean } => typeof entry.value === 'number' && Number.isFinite(entry.value))
    if (known.length < 30) continue
    const cut = median(known.map(entry => entry.value)) ?? 0
    const high = known.filter(entry => entry.value > cut)
    const low = known.filter(entry => entry.value <= cut)
    if (high.length < 10 || low.length < 10) continue
    const rate = (group: typeof known) => group.filter(entry => entry.label).length / group.length
    const difference = rate(high) - rate(low)
    const larger = Math.max(rate(high), rate(low))
    const smaller = Math.min(rate(high), rate(low))
    if (Math.abs(difference) < 0.08 && !(Math.abs(difference) >= 0.02 && larger >= smaller * 1.6)) continue
    const shown = cut === 0 ? '0' : Math.abs(cut) >= 100 ? Math.round(cut).toLocaleString('en-US') : Math.abs(cut) >= 10 ? cut.toFixed(0) : cut.toFixed(2)
    results.push({
      text: `${spec.label} ${difference > 0 ? 'above' : 'at or below'} ${shown}: ${Math.round(Math.max(rate(high), rate(low)) * 100)}% ${outcome}, vs ${Math.round(Math.min(rate(high), rate(low)) * 100)}% otherwise`,
      strength: Math.abs(difference) / Math.max(0.05, larger),
    })
  }
  return results.sort((first, second) => second.strength - first.strength).slice(0, limit).map(item => item.text)
}
