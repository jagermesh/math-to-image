module.exports = {
  root: true,
  env: {
    node: true,
    es2020: true,
    commonjs: true,
    browser: true,
  },
  extends: [
    'eslint:recommended',
  ],
  parserOptions: {
    ecmaVersion: '2020',
    sourceType: 'module',
  },
  rules: {
    'no-eval': 1,
    'no-unused-vars': 1,
    'no-empty': 1,
    'no-useless-escape': 1,
    'no-inner-declarations': 1,
    'no-case-declarations': 1,
    'no-prototype-builtins': 1,
    'indent': ['error', 2, {
      'SwitchCase': 1,
    }],
    'no-duplicate-imports': 2,
    'no-self-compare': 2,
    'no-template-curly-in-string': 2,
    'space-in-parens': 2,
    'new-parens': 2,
    'space-infix-ops': 2,
    'space-unary-ops': 2,
    'switch-colon-spacing': 2,
    'template-curly-spacing': 2,
    'template-tag-spacing': 2,
    'yield-star-spacing': 2,
    'space-before-blocks': 2,
    'semi-style': 2,
    'semi-spacing': 2,
    'semi': 2,
    'quotes': [
      'error',
      'single',
    ],
    'operator-linebreak': [
      'error',
      'after',
    ],
    'object-property-newline': 2,
    'object-curly-spacing': [
      'error',
      'always',
    ],
    'object-curly-newline': ['error',
      {
        'minProperties': 1,
      },
    ],
    'nonblock-statement-body-position': [
      'error',
      'below',
    ],
    'no-whitespace-before-property': 2,
    'no-trailing-spaces': 2,
    'no-tabs': 2,
    'no-multiple-empty-lines': 2,
    'no-multi-spaces': 2,
    'no-mixed-spaces-and-tabs': 2,
    'max-statements-per-line': [
      'error',
      {
        'max': 1,
      },
    ],
    'lines-between-class-members': 2,
    'implicit-arrow-linebreak': 2,
    'key-spacing': [
      'error',
      {
        'beforeColon': false,
        'afterColon': true,
      },
    ],
    'keyword-spacing': [
      'error',
      {
        'before': true,
      },
    ],
    'func-call-spacing': [
      'error',
      'never',
    ],
    'comma-style': [
      'error',
      'last',
    ],
    'comma-spacing': [
      'error',
      {
        'before': false,
        'after': true,
      },
    ],
    'comma-dangle': [
      'error',
      'always-multiline',
    ],
    'brace-style': 2,
    'block-spacing': 2,
    'arrow-spacing': 2,
    'arrow-parens': 2,
    'array-element-newline': [
      'error',
      'consistent',
    ],
  },
};
