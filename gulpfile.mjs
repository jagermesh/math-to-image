import gulp from 'gulp';
import eslint from 'gulp-eslint-new';

const configs = {
  eslint: {
    src: [
      'libs/*.js',
    ],
  },
};

gulp.task('eslint', () => {
  return gulp.src(configs.eslint.src)
    .pipe(eslint({
      fix: true,
      quiet: true,
    }))
    .pipe(eslint.fix())
    .pipe(eslint.format())
    .pipe(eslint.failAfterError());
});

gulp.task('build',
  gulp.series('eslint'));