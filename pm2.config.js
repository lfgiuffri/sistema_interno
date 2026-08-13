module.exports = {
  apps : [
      {
        name: "sgp",
        script: "./build/index.js",
        watch: true,
        node_args : '-r dotenv/config'
      }
  ]
}