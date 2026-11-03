export const CHARACTERS = [
  { id: 'pip', name: 'Pip', color: '#ffcf4a', shape: 'round', extra: 'tuft' },
  { id: 'bolt', name: 'Bolt', color: '#39d0ff', shape: 'square', extra: 'antenna' },
  { id: 'mochi', name: 'Mochi', color: '#ff8fc7', shape: 'round', extra: 'ears' },
  { id: 'rook', name: 'Rook', color: '#2fd6a3', shape: 'square', extra: 'cap' },
  { id: 'nova', name: 'Nova', color: '#b388ff', shape: 'drop', extra: 'star' },
  { id: 'fizz', name: 'Fizz', color: '#ff7a1a', shape: 'drop', extra: 'tuft' },
  { id: 'juno', name: 'Juno', color: '#5cffb0', shape: 'round', extra: 'antenna' },
  { id: 'taro', name: 'Taro', color: '#8aa2ff', shape: 'square', extra: 'ears' },
];

export const characterById = Object.fromEntries(CHARACTERS.map((c) => [c.id, c]));

export function avatar(id, size = 48, mood = 'happy') {
  const ch = characterById[id] || CHARACTERS[0];
  const c = ch.color;
  const body = ch.shape === 'square'
    ? `<rect x="11" y="16" width="42" height="42" rx="11" fill="${c}"/>`
    : ch.shape === 'drop'
      ? `<path d="M32 9C45 23 54 32 54 42a22 19 0 0 1-44 0C10 32 19 23 32 9Z" fill="${c}"/>`
      : `<circle cx="32" cy="37" r="22" fill="${c}"/>`;
  const behind = ch.extra === 'ears' ? `<circle cx="15" cy="20" r="7" fill="${c}"/><circle cx="49" cy="20" r="7" fill="${c}"/><circle cx="15" cy="20" r="3" fill="#0003"/><circle cx="49" cy="20" r="3" fill="#0003"/>` : '';
  const top = ch.extra === 'tuft' ? `<path d="M29 17q1-10 7-9q-5 3-3 10z" fill="${c}"/>`
    : ch.extra === 'antenna' ? '<line x1="32" y1="17" x2="32" y2="6" stroke="#5d6b86" stroke-width="2.5"/><circle cx="32" cy="6" r="3.6" fill="#ff5a7a"/>'
      : ch.extra === 'cap' ? '<path d="M13 25q19-17 38 0z" fill="#1b2438"/><rect x="40" y="21.5" width="17" height="4" rx="2" fill="#1b2438"/>'
        : ch.extra === 'star' ? '<path d="M32 2l2.6 5.4 5.9.8-4.3 4.1 1 5.8L32 15.3l-5.2 2.8 1-5.8-4.3-4.1 5.9-.8z" fill="#ffd23b"/>' : '';
  const mouth = mood === 'sad' ? '<path d="M27 50q5-4 10 0" stroke="#111" stroke-width="2.4" fill="none" stroke-linecap="round"/>'
    : mood === 'wow' ? '<ellipse cx="32" cy="48" rx="4" ry="5" fill="#111"/>'
      : '<path d="M26 46q6 6 12 0" stroke="#111" stroke-width="2.4" fill="none" stroke-linecap="round"/>';
  return `<svg class="avatar" width="${size}" height="${size}" viewBox="0 0 64 64" aria-hidden="true">${behind}${body}<ellipse cx="24" cy="27" rx="7" ry="4" fill="#fff" opacity=".28"/>${top}<circle cx="25" cy="37" r="5.2" fill="#fff"/><circle cx="39" cy="37" r="5.2" fill="#fff"/><circle cx="26" cy="38" r="2.5" fill="#111"/><circle cx="40" cy="38" r="2.5" fill="#111"/><circle cx="19" cy="45" r="2.6" fill="#ff5a7a" opacity=".35"/><circle cx="45" cy="45" r="2.6" fill="#ff5a7a" opacity=".35"/>${mouth}</svg>`;
}
