import '../_shared/peer-global';

if (new URLSearchParams(location.search).get('engine') === 'next') {
  void import('./next/boot').then((next) => next.start());
} else {
  void import('./render-three/main.js');
}
