import React, { Component, createRef } from 'react'
import {StyleSheet, View, Text, ActivityIndicator} from 'react-native'
import debounce from 'lodash/debounce'
import isEqual from 'lodash/isEqual'
import pick from 'lodash/pick'
import last from 'lodash/last'
import { ENV } from '@peakers/react-native-env'

import Swiper from './index'
import { LinearGradient } from 'expo-linear-gradient'
import { TouchableOpacity } from '@peakers/react-native-pkrs-analytics'
import { colors, sizes } from '@peakers/css'

const WINDOW_LENGTH = 15
const isDev = ENV === 'development'

class LazySwiper extends Component {
  static propTypes = Swiper.propTypes
  static OPERATIONS = [
    'updateIndex',
    'cleanupScrolling',
    'updateRead',
    'propagateIndex',
    'tryToUpdateChildren',
    'appendChild',
    'prepareForRender',
    'processRequests'
  ]

  static next(prev) {
    return LazySwiper.OPERATIONS[LazySwiper.OPERATIONS.indexOf(prev) + 1]
  }

  get index() {
    return this.state.externalIndex
  }

  get isFirst () {
    return this.index === 0
  }

  get isLast () {
    return this.props.children.length - 1 === this.index
  }

  get isBeforeLast () {
    return this.props.children.length - 2 === this.index
  }

  get isChildrenChanged() {
    return this.props.children.length !== this.state.renderedWith
  }

  constructor (props) {
    super(props)

    const externalIndex = props.index || 0
    const window = this.getWindow(props, externalIndex)

    this.state = {
      key: 0,
      ...window,
      externalIndex,
      children: props.children.slice(window.start, window.end),
      renderRegistry: new Set(),
      readRegistry: new Set(),
      requests: [],
      renderedWith: props.children.length,
      isRendering: true,
      direction: -1
    }
    this.swiper = createRef()
    this.finishRendering = debounce(this.finishRendering.bind(this), 0)
    this.updateChildren = debounce(this.updateChildren.bind(this), 0)

    this.delayUntilRendered('scrollBy')
    this.delayUntilRendered('scrollTo')
  }

  delayUntilRendered(method) {
    this[method] = (...args) => {
      this.setState({
        requests: [...this.state.requests, { method, args }]
      })
    }
  }

  componentDidUpdate (...args) {
    let operation = LazySwiper.next()
    let done = false

    while (!done && operation) {
      done = this[operation](...args)
      operation = LazySwiper.next(operation)
    }
  }

  updateIndex(prevProps, prevState) {
    const { externalIndex: prevExternalIndex, index } = this.state
    let isChanged = index !== prevState.index

    if (!isChanged) { return isChanged }

    const externalIndex = this.getExternalIndex(index)
    isChanged = externalIndex !== prevExternalIndex

    if (isChanged) {
      this.setState({
        externalIndex,
        direction: index - prevState.index
      })
    }

    return isChanged
  }

  cleanupScrolling() {
    const { scrollTo, index, start, end } = this.state

    if (isEqual(scrollTo, { index, start, end })) {
      this.setState({ scrollTo: null })
    }
  }

  updateRead() {
    const { index, hasUnread } = this.state
    const externalIndex = this.getExternalIndex(index)
    const isLast = externalIndex + 1 === this.props.children.length

    if (isLast && hasUnread) {
      this.setState({ hasUnread: false })
    }
  }

  propagateIndex(prevProps, prevState) {
    const { externalIndex } = this.state
    const { onIndexChanged } = this.props

    if (typeof onIndexChanged === 'function' && prevState.externalIndex !== externalIndex) {
      onIndexChanged(externalIndex)
    }
  }

  tryToUpdateChildren(prevProps, prevState) {
    if (prevState.externalIndex !== this.state.externalIndex) {
      this.updateChildren()
    }
  }

  updateChildren() {
    const { start, end } = this.state
    this.setState({ children: this.props.children.slice(start, end) })
  }

  isWindowChanged(prevState) {
    const props = ['index', 'start', 'end']
    return !isEqual(pick(prevState, props), pick(this.state, props))
  }

  isEqual(left, right) {
    return this.toComparable(left) === this.toComparable(right)
  }

  toComparable(children) {
    return children.map(child => child.key).join()
  }

  appendChild(prevProps) {
    const { index, children, end, renderedWith } = this.state
    const isLast = index + 1 === children.length
    const appendedChild = this.getAppendedChild(prevProps)
    const isActionable = appendedChild && end + 1 === this.props.children.length
    const nextEnd = end + 1
    const state = {}

    if (isActionable) {
      Object.assign(state, {
        children: [...children, appendedChild],
        end: nextEnd,
        renderedWith: renderedWith + 1
      })
    }

    if (appendedChild && !isLast) {
      Object.assign(state, {
        hasUnread: true
      })
    }

    if (Object.keys(state).length) {
      this.setState(state)
    }

    return isActionable
  }

  getAppendedChild(prevProps) {
    const { children } = this.props
    const lastIndex = children.length - 1
    const lastChild = children[lastIndex]
    const prevKey = last(prevProps.children).key

    return prevKey !== lastChild.key
      && prevKey === children[lastIndex - 1].key
      && lastChild
  }

  prepareForRender() {
    const { isRendering, index, externalIndex, children, scrollTo } = this.state

    if (isRendering) { return false }

    const maxIndex = children.length - 1
    const externalMaxIndex = this.props.children.length - 1
    const isFirst = index < 1
    const isPrevExists = externalIndex > 0
    const isLast = index === maxIndex
    const isNextExists = externalIndex < externalMaxIndex
    const { isChildrenChanged } = this

    const isAbleToRender = isFirst && !scrollTo && (isPrevExists || isChildrenChanged)
      || isLast && (isNextExists || isChildrenChanged)

    if (isAbleToRender) {
      this.setState({ isRendering: true })
    }

    return isAbleToRender
  }

  processRequests() {
    if (this.state.isRendering) { return }
    const requests = this.state.requests.slice(0)
    const { length } = requests

    while (requests.length) {
      const { method, args } = last(requests)

      if (this[`process${cap(method)}`](...args)) {
        requests.pop()
      } else {
        break
      }
    }

    if (requests.length !== length) {
      this.setState({ requests })
    }
  }

  processScrollBy(shift, isAnimated) {
    const { index, children, renderRegistry } = this.state
    const nextIndex = index + shift
    const key = children[nextIndex]?.key
    const hasIndex = renderRegistry.has(key)

    if (hasIndex) {
      this.swiper.current.scrollBy(shift, isAnimated)
    }

    return hasIndex
  }

  // TODO: implement scrolling out of the window
  // TODO: see `scrollToBottom` method for implementation ideas
  processScrollTo(index, isAnimated) {
    if (isDev) {
      console.warn('scrollTo might not be working properly if target is not rendered')
    }

    const internalIndex = this.getInternalIndex(index)
    const hasIndex = internalIndex > -1

    if (hasIndex) {
      this.swiper.current.scrollTo(internalIndex, isAnimated)
    }

    return hasIndex
  }

  rerender(index) {
    const externalIndex = this.getExternalIndex(index)
    const window = this.getWindow(this.props, externalIndex)
    const children = this.props.children.slice(window.start, window.end)

    this.setState({
      ...window,
      children,
      key: this.state.key === 1 ? 0 : 1,
      renderRegistry: new Set(),
      externalIndex,
      renderedWith: this.props.children.length
    })
  }

  getWindow({ children }, index) {
    const maxIndex = children.length
    const { key } = children[index]
    let start = index - (WINDOW_LENGTH - 1) / 2
    let end = index + (WINDOW_LENGTH + 1) / 2

    if (start < 0) { start = 0 }
    if (end > maxIndex) { end = maxIndex }

    return {
      index: children.slice(start, end).findIndex(child => child.key === key),
      start,
      end
    }
  }

  registerChild(key) {
    const renderRegistry = new Set(this.state.renderRegistry.add(key))
    this.setRenderingState({ renderRegistry })
  }

  setRenderingState(partial) {
    this.setState(partial)

    if (!this.state.isRendering) { return }

    const { keyRendered, key, renderRegistry, children } = {
      ...this.state,
      ...partial
    }

    const isSwiperRendered = keyRendered === key
    const areChildrenRendered = children
      .every(child => renderRegistry.has(child.key))

    if (isSwiperRendered && areChildrenRendered) {
      this.finishRendering()
    }
  }

  finishRendering() {
    this.setState({ isRendering: false })
  }

  getExternalIndex(internalIndex) {
    const { key } = this.state.children[internalIndex]
    return this.props.children.findIndex(child => child.key === key)
  }

  getInternalIndex(externalIndex) {
    const { key } = this.props.children[externalIndex]

    if (!this.state.renderRegistry.has(key)) {
      return -1
    }

    return this.state.children.findIndex(child => child.key === key)
  }

  next() {
    this.scrollBy(1, true)
  }

  scrollToBottom() {
    const lastExternal = last(this.props.children)
    const lastInternal = last(this.state.children)

    if (lastExternal.key !== lastInternal.key) {
      this.rerenderToScrollTo(this.props.children.length - 1)
    }

    this.scrollTo(this.props.children.length - 1, true)
  }

  rerenderToScrollTo(targetIndex) {
    const { children, index } = this.state
    const window = this.getWindow(this.props, targetIndex)
    const nextChildren = this.props.children.slice(window.start, window.end)
    nextChildren.splice(0, 1, children[index])

    this.setState({
      ...window,
      key: this.state.key === 1 ? 0 : 1,
      index: 0,
      children: nextChildren,
      renderRegistry: new Set(),
      renderedWith: this.props.children.length,
      scrollTo: window
    })
  }

  debug() {
    const { children, index, externalIndex, start, end, isRendering, renderRegistry } = this.state

    return <View style={[styles.loader, { top: 30 }]}>
      <Text style={{color: 'white'}}>development debug</Text>
      <Text style={{color: 'white'}}>swiper: {index}/{children.length - 1}</Text>
      <Text style={{color: 'white'}}>external: {externalIndex}/{this.props.children.length - 1}</Text>
      <Text style={{color: 'white'}}>window: {start}-{end - 1}/{this.props.children.length - 1}</Text>
      <Text style={{color: 'white'}}>rendered: {renderRegistry.size - 1}</Text>
      {isRendering && <Text style={{color: 'white'}}>rendering...</Text>}
    </View>
  }

  render () {
    const { children, index, key, isRendering, hasUnread, direction } = this.state
    const { children: _, onIndexChanged: __, ...props } = this.props

    Object.assign(props, {
      ref: this.swiper,
      scrollEnabled: !isRendering,
      index: index,
      horizontal: false,
      loop: false,
      onMomentumScrollEnd: (_, state) => this.setState({ index: state.index }),
      style: { opacity: isRendering ? 0 : 1 }
    })

    return <View style={{ position: 'relative', flex: 1 }}>
      {isRendering && <View onLayout={() => this.rerender(index)} style={styles.disabler} >
        {children[index]}
      </View>}
      {isRendering && <View style={[styles.loader, direction < 0 ? { top: 0 } : { bottom: 200 }]}>
        <ActivityIndicator size="large" color={colors.light} />
      </View>}
      {isDev && this.debug()}
      <View key={key} style={{ flex: 1 }} onLayout={() => this.setRenderingState({ keyRendered: key })}>
        <Swiper {...props}>
          {children.map(child => <View
            key={`wrapper-${child.key}`}
            onLayout={() => this.registerChild(child.key)}
          >{child}</View>)}
        </Swiper>
      </View>
      {hasUnread && <TouchableOpacity
        onPress={() => this.scrollToBottom()}
        style={styles.unreadBtn}
      >
        <LinearGradient
          start={{ x: 0.0, y: 0.25 }}
          end={{ x: 1.5, y: 1.0 }}
          locations={[0, 0.5]}
          colors={['#FFC371', '#FF5F6D']}
          style={styles.unreadGradient}
        >
          <Text style={styles.unreadText}>
            ↓ Latest messages
          </Text>
        </LinearGradient>
      </TouchableOpacity>}
    </View>
  }
}

function cap(str) {
  return str[0].toUpperCase() + str.slice(1)
}

const styles = StyleSheet.create({
  loader: {
    position: 'absolute',
    left: 0,
    right: 0,
    height: 30,
    width: '100%',
    alignItems: 'center',
    justifyContent: 'center'
  },
  disabler: {
    zIndex: 1,
    position: 'absolute',
    top: 0,
    bottom: 0,
    left: 0,
    right: 0
  },
  unreadBtn: {
    position: 'absolute',
    bottom: 30,
    zIndex: 1,
    alignSelf: 'center'
  },
  unreadGradient: {
    paddingVertical: 2,
    paddingHorizontal: 15,
    width: '100%',
    borderRadius: 3,
    justifyContent: 'center'
  },
  unreadText: {
    color: colors.light,
    textAlign: 'center',
    fontWeight: 'bold',
    fontSize: sizes.fonts.x4
  }
})

export default LazySwiper
