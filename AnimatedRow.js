import React from 'react';
import { View, Text, TouchableOpacity, Dimensions, ScrollView, Platform, TextInput, Animated, Alert } from 'react-native';
import { Entypo, MaterialIcons } from 'react-native-vector-icons';
import theme from '../theme';

export default class AnimatedRow extends React.Component {
	constructor(props) {
		super(props);
		this.state = {
			translateX: new Animated.Value(this.props.optionsWidth * (this.props.trans || -1)),
			options: false,
			optionsShown: false,
		}
	}

	componentWillReceiveProps(nextProps, nextState){

		//resets animation state of the component if the row content changes
		if(nextProps.id != this.props.id){
			this.state.translateX.setValue(nextProps.optionsWidth * (nextProps.trans || -1))
		}
	}

	//this class method starts an animation on the native driver that exposes options on the row
	animateOptions(){
		const animation = this.state.options ?
			Animated.timing(
		      this.state.translateX,
		      {
		        toValue: this.props.optionsWidth * (this.props.trans || -1),
		        duration: 200,
		        useNativeDriver: true,
		      }
		    )
	    :
	    	Animated.timing(
		      this.state.translateX,
		      {
		        toValue: this.props.trans ? this.props.trans * this.props.optionsWidth * -1 : 0,
		        duration: 200,
		        useNativeDriver: true,
		      }
		    )

	    animation.start();

	    this.setState({options: !this.state.options})
	}

	render () {


		{/*
			The animated AnimatedRow component accepts the following props:
				title (string)
				subtitle (string)
				either options (react node) or onPress (function)
			
			Options accepts the following props:
				label (string)
				color (string)
				icon (react node)
				onPress (function)
		*/}


		const { width, height } = Dimensions.get('window')

		//styles object
		const styles = {
			content: {
				height: 64,
		        borderBottomColor: 'lightgray',
		        borderBottomWidth: 1,
		        backgroundColor: 'white',
		        padding: 8,
		        flexDirection: 'row',
		        width,
			},
			main: {
				width: !!(this.props.value && this.props.units) ? width-80 : width,
				justifyContent: 'center',
				flexDirection: 'column',
			},
			units: {
				paddingLeft: 8, 
				justifyContent: 'center', 
				alignItems: 'center',
				flexDirection: 'column', 
				width: 80,
			},
			animatedWrapper: {
				flexDirection: 'row', 
				width: width + this.props.optionsWidth, 
				transform: [{translateX: this.state.translateX}]
			},
			animatedOptionsWrapper: {
				opacity: this.state.translateX.interpolate({
					inputRange: [this.props.optionsWidth * (this.props.trans || -1), 0],
					outputRange: [0, 1],
				})
			}
		}

		//render main row content
		const content = <View style={styles.content}>
            <View style={styles.main}>
              <Text numberOfLines={1} style={{color: 'black', fontSize: 15,}}>
                {this.props.title || 'Title'}
              </Text>
              <Text numberOfLines={1} style={{color: 'gray', fontSize: 12,}}>
                {this.props.subtitle || 'subtitle'}
              </Text>
            </View>
            {
            	!(this.props.value && this.props.units) ? null :
            	<View style={styles.units}>
            		<Text numberOfLines={1}>{this.props.value}</Text>
            		<Text numberOfLines={1} style={{color: 'gray', fontSize: 12,}}>{this.props.units}</Text>
            	</View>
        	}
	      </View>

		return this.props.options && this.props.optionsWidth ? 

			//when given both options (React node) and optionsWidth (number) as props
			//return a row that animates this.props.options node in from the left when tapped

			<Animated.View style={styles.animatedWrapper}>
				<Animated.View style={styles.animatedOptionsWrapper}>
	      			{this.props.options}
	      		</Animated.View>
	      		<TouchableOpacity onPress={() => this.animateOptions()} style={{width}}>
			        {content}
			    </TouchableOpacity>
			</Animated.View>
			:

			//otherwise return an onPress wrapper over main content
			<TouchableOpacity onPress={this.props.onPress}>
				{content}
			</TouchableOpacity>
	}
}