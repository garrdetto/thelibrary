import '../_shared/peer-global';

const query = new URLSearchParams(location.search);
if (query.get('engine') === 'next' && query.get('scene') === 'test') {
  void import('./next/boot').then((next) => next.start());
} else {
  void import('./render-three/main.js');
}
