import gulp from 'gulp';
import eslint from 'gulp-eslint';

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
      quiet: true,
    }))
    .pipe(eslint.format())
    .pipe(eslint.failAfterError());
});

gulp.task('build',
  gulp.series('eslint'));