module.exports = {
  apps : [
      {
        name: "sistema_interno",
        script: "./build/index.js",
        watch: false,
        node_args : '-r dotenv/config'
      }
  ]
}
