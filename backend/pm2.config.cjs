module.exports = {
  apps : [
      {
        name: "lifesync",
        script: "./build/index.js",
        watch: false,
        node_args : '-r dotenv/config'
      }
  ]
}
