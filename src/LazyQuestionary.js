import React, { Component, createRef } from 'react'
import { View } from 'react-native'
import PropTypes from 'prop-types'
import last from 'lodash/last'

import Swiper from './index'

class LazyQuestionary extends Component {
  static propTypes = Object.assign(Swiper.propTypes, {
    slideWrapperStyle: PropTypes.oneOfType([
      PropTypes.object,
      PropTypes.number,
      PropTypes.array
    ]),
    showAll: PropTypes.bool,
    resolveCurrentSlide: PropTypes.func
  })

  static defaultProps = {
    showAll: false,
    resolveCurrentSlide(props, state) {
      return props.children[state.currentIndex].key
    }
  }

  get isFirst () {
    return this.state.currentIndex  === 0
  }

  get isLast () {
    const { visibleCount, currentIndex } = this.state
    return visibleCount === currentIndex + 1
  }

  get visibleSlides () {
    const { children } = this.props
    const { visibleCount } = this.state
    return children.slice(0, visibleCount)
  }

  get isRendering () {
    return this.visibleSlides.some(child => !this.state.renderedSlides.has(child.key))
  }

  constructor (props) {
    super(props)

    this.swiper = createRef()

    const currentIndex = props.index || 0
    const { children, resolveCurrentSlide } = props

    this.state = {
      visibleCount: props.showAll ? undefined : 1,
      currentIndex: currentIndex,
      currentSlide: resolveCurrentSlide({ children }, { currentIndex }),
      nextIndex: currentIndex,
      requests: [],
      renderedSlides: new Set()
    }
  }

  componentDidUpdate (prevProps, prevState) {
    if (this.syncSlide(prevProps, prevState)) { return }
    if (this.syncIndex()) { return }
    if (!this.isRendering) {
      this.processRequests()
    }
  }

  syncSlide(prevProps, prevState) {
    const { children } = this.props
    const { currentIndex } = this.state
    const isSlideChanged = prevState.currentIndex !== currentIndex

    if (isSlideChanged) {
      this.setState({ currentSlide: children[currentIndex].key })
    }

    return isSlideChanged
  }

  syncIndex() {
    const { currentSlide } = this.state
    const resolvedCurrentSlide = this.props.resolveCurrentSlide(this.props, this.state)
    if (resolvedCurrentSlide === currentSlide || this.isRendering) {
      return false
    }

    const index = this.props.children.findIndex(child => child.key === currentSlide)

    if (index === -1) {
      return false
    }

    this.swiper.current.scrollTo(index, false)

    return true
  }

  processRequests() {
    const { requests } = this.state
    const { length } = requests

    while (requests.length) {
      const request = last(requests)
      const { method, args: [index, ...args] } = request

      if (this.hasIndex(index, method)) {
        this.swiper.current[method](index, ...args)
        requests.pop()
      } else {
        break
      }
    }

    if (requests.length !== length) {
      this.setState({ requests })
    }
  }

  hasIndex(index, method) {
    const { currentIndex, visibleCount, renderedSlides } = this.state
    const nextIndex = method === 'scrollTo' ? index : currentIndex + index

    return (!visibleCount || nextIndex < visibleCount) && nextIndex < renderedSlides.size
  }

  updateSlideCount(key) {
    const { showAll } = this.props
    const { renderedSlides, visibleCount } = this.state
    renderedSlides.add(key)

    this.setState({
      renderedSlides,
      visibleCount: showAll ? undefined : visibleCount
    })
  }

  scrollTo (...args) {
    this.setState({
      requests: [...this.state.requests, { method: 'scrollTo', args }]
    })
  }

  scrollBy (...args) {
    this.setState({
      requests: [...this.state.requests, { method: 'scrollBy', args }]
    })
  }

  showNext () {
    if (!this.props.showAll) {
      this.setState({
        visibleCount: this.state.visibleCount + 1
      })
    }
  }

  resetAndScroll () {
    if (!this.props.showAll) {
      const { currentIndex, renderedSlides } = this.state
      const visibleCount = currentIndex + 2
      this.setState({
        visibleCount,
        renderedSlides: new Set(Array.from(renderedSlides).slice(0, visibleCount - 1))
      })
      this.scrollBy(1, true)
    }
  }

  updateIndexes(index) {
    this.setState({
      currentIndex: index,
      nextIndex: index
    })
  }

  render () {
    const { visibleCount } = this.state
    const { onIndexChanged, slideWrapperStyle, children, ...props } = this.props

    return (
      <Swiper
        {...props}
        onIndexChanged={(...args) => {
          this.updateIndexes(args[0])
          if (typeof onIndexChanged === 'function') {
            onIndexChanged(...args)
          }
        }}
        ref={this.swiper}
      >
        {children.slice(0, visibleCount).map(child => <View
          key={`inner-${child.key}`}
          onLayout={() => this.updateSlideCount(child.key)}
          style={slideWrapperStyle}
        >
          {child}
        </View>)}
      </Swiper>
    )
  }
}

export default LazyQuestionary
