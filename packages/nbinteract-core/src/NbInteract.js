import debounce from 'lodash.debounce'

import { Kernel, ServerConnection } from '@jupyterlab/services'

import { WidgetManager } from './manager'
import * as util from './util.js'
import BinderHub from './BinderHub'

const DEFAULT_BASE_URL = 'https://mybinder.org'
const DEFAULT_PROVIDER = 'gh'
const DEFAULT_SPEC = 'SamLau95/nbinteract-image/master'

/**
 * Main entry point for nbinteract.
 *
 * Class that runs notebook code and creates widgets.
 */
export default class NbInteract {
  /**
   * Initialize NbInteract. Does not start kernel until run() is called.
   *
   * @param {Object} [config] - Configuration for NbInteract
   *
   * @param {String} [config.spec] - BinderHub spec for Jupyter image. Must be
   *     in the format: `${username}/${repo}/${branch}`. Defaults to
   *     'SamLau95/nbinteract-image/master'.
   *
   * @param {String} [config.baseUrl] - Binder URL to start server. Defaults to
   *     https://mybinder.org.
   *
   * @param {String} [config.provider] - BinderHub provider. Defaults to 'gh'
   *     for GitHub.
   */
  constructor(
    {
      spec = DEFAULT_SPEC,
      baseUrl = DEFAULT_BASE_URL,
      provider = DEFAULT_PROVIDER,
    } = {},
  ) {
    this.run = debounce(this.run, 500, {
      leading: true,
      trailing: false,
    })
    this._kernelHeartbeat = this._kernelHeartbeat.bind(this)

    this.binder = new BinderHub({ spec, baseUrl, provider, local: false })

    // Keep track of properties for debugging
    this.kernel = null
    this.manager = null
  }

  async run() {
    if (!util.pageHasWidgets()) {
      console.log('No widgets detected, stopping nbinteract.')

      // Warm up kernel so the next run is faster
      if (!this.kernel) {
        this.kernel = await this._getOrStartKernel()
      }
      return
    }

    const firstRun = !this.kernel || !this.manager
    try {
      this.kernel = await this._getOrStartKernel()
      this.manager = this.manager || new WidgetManager(this.kernel)
      this.manager.generateWidgets()

      if (firstRun) this._kernelHeartbeat()
    } catch (err) {
      debugger
      console.log('Error in code initialization!')
      throw err
    }
  }

  /**
   * Checks kernel connection every seconds_between_check seconds. If the
   * kernel is dead, starts a new kernel and re-creates widgets.
   */
  async _kernelHeartbeat(seconds_between_check = 5) {
    console.log('Kernel heartbeat')
    try {
      const { kernelModel } = await this._getKernelModel()
    } catch (err) {
      console.log('Looks like the kernel died:', err.toString())
      console.log('Starting a new kernel...')

      const kernel = await this._startKernel()
      this.kernel = kernel

      this.manager.setKernel(kernel)
      this.manager.generateWidgets()
    } finally {
      setTimeout(this._kernelHeartbeat, seconds_between_check * 1000)
    }
  }

  /**
   * Private method that starts a Binder server, then starts a kernel and
   * returns the kernel information.
   *
   * Once initialized, this function caches the server and kernel info in
   * localStorage. Future calls will attempt to use the cached info, falling
   * back to starting a new server and kernel.
   */
  async _getOrStartKernel() {
    if (this.kernel) {
      return this.kernel
    }

    try {
      const kernel = await this._getKernel()
      console.log('Connected to cached kernel.')
      return kernel
    } catch (err) {
      console.log(
        'No cached kernel, starting kernel on BinderHub:',
        err.toString(),
      )
      const kernel = await this._startKernel()
      return kernel
    }
  }

  /**
   * Connects to kernel using cached info from localStorage. Throws exception
   * if kernel connection fails for any reason.
   */
  async _getKernel() {
    const { serverSettings, kernelModel } = await this._getKernelModel()
    return await Kernel.connectTo(kernelModel, serverSettings)
  }

  /**
   * Retrieves kernel model using cached info from localStorage. Throws
   * exception if kernel doesn't exist.
   */
  async _getKernelModel() {
    const { serverParams, kernelId } = localStorage
    const { url, token } = JSON.parse(serverParams)

    const serverSettings = ServerConnection.makeSettings({
      baseUrl: url,
      wsUrl: util.baseToWsUrl(url),
      token: token,
    })

    const kernelModel = await Kernel.findById(kernelId, serverSettings)
    return { serverSettings, kernelModel }
  }

  /**
   * Starts a new kernel using Binder and returns the connected kernel. Stores
   * localStorage.serverParams and localStorage.kernelId .
   */
  async _startKernel() {
    try {
      console.time('start_server')
      const { url, token } = await this.binder.startServer()
      console.timeEnd('start_server')

      // Connect to the notebook webserver.
      const serverSettings = ServerConnection.makeSettings({
        baseUrl: url,
        wsUrl: util.baseToWsUrl(url),
        token: token,
      })

      console.time('start_kernel')
      const kernelSpecs = await Kernel.getSpecs(serverSettings)
      const kernel = await Kernel.startNew({
        name: kernelSpecs.default,
        serverSettings,
      })
      console.timeEnd('start_kernel')

      // Store the params in localStorage for later use
      localStorage.serverParams = JSON.stringify({ url, token })
      localStorage.kernelId = kernel.id

      console.log('Started kernel:', kernel.id)
      return kernel
    } catch (err) {
      debugger
      console.error('Error in kernel initialization!')
      throw err
    }
  }

  async _killKernel() {
    const kernel = await this._getKernel()
    return kernel.shutdown()
  }
}
