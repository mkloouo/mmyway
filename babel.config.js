module.exports = function (api) {
  api.cache(true);
  return {
    presets: ['babel-preset-expo'],
    // Inlines .sql migration files as string literals so Metro (no runtime fs access)
    // can bundle them — see src/db/migrations.ts.
    plugins: [['inline-import', { extensions: ['.sql'] }]],
  };
};
