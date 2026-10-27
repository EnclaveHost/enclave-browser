import { execFileSync } from 'node:child_process';
execFileSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc2=size=960x600:rate=30:duration=1',
  '-c:v', 'libvpx-vp9', '-deadline', 'realtime', '-cpu-used', '8', '-threads', '2', '-an', 'media.webm'], { stdio: 'inherit' });
