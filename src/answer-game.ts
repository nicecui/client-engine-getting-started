import { Event, Play, Room } from "@leancloud/play";
import d = require("debug");
import _ = require("lodash");
import { tap } from "rxjs/operators";
import { AutomaticGame } from "./automation";
import { listen } from "./utils";
import { APP_ID, APP_KEY, MASTER_KEY } from "./configs";
import AV = require("leancloud-storage");
import { async } from "rxjs/internal/scheduler/async";
import {autoStart, autoDestroy, AutomaticGameEvent} from "./automation";

const debug = d("RPS");

// [✊, ✌️, ✋] wins [✌️, ✋, ✊]
const wins = [1, 2, 0];

/**
 * 石头剪刀布游戏
 */

@autoDestroy()
@autoStart()
export default class RPSGame extends AutomaticGame {
  public reservationHoldTime = 12000;

  constructor(room: Room, masterClient: Play) {
    super(room, masterClient);
    // 初始化数据存储服务
    // AV.init({
    //   appId: APP_ID,
    //   appKey: APP_KEY,
    //   masterKey: MASTER_KEY
    // });
    this.once(AutomaticGameEvent.ROOM_FULL, () => this.roomFull());
    this.masterClient.on(Event.PLAYER_ROOM_JOINED, () => {
      console.log('有人来了有人来了有人来了');
    });

  }

  public terminate() {
    // 将游戏 Room 的 open 属性标记为 false，不再允许用户加入了。
    // 客户端可以按照业务需求响应该属性的变化（例如对于还未开始的游戏，客户端可以重新发起加入新游戏请求）。
    this.masterClient.setRoomOpened(false);
    return super.terminate();
  }

  protected async start(): Promise<void> {}

  protected async roomFull(): Promise<void> {
    // 获取本次对战需要的题目
    try {
      // const questions = await AV.Cloud.run('getMultiplayerQuestions');
      const questions = await this.getMultiplayerQuestions();
      // 标记房间不再可加入
      this.masterClient.setRoomOpened(false);
      // 将题目设置为房间属性
      const roomProps: {[key: string]: any} = {
        questions: questions,
        currentQuestionIndex: 0,
      };
      // 设置每个玩家的初始得分
      const playerData : {[key: string]: any}= {};
      roomProps.playerData = playerData;
      for (let i = 0; i < this.players.length; i++) {
        const player = this.players[i];
        const playerId = player.actorId;
        roomProps.playerData[playerId] = {
          score: 0,
          currentOption: -1,
        };
        
      }
      this.room.setCustomProperties(roomProps);
    } catch (error) {
      console.log(error); 
    }

    // 向客户端广播游戏开始事件
    this.broadcast("startGame");

    this.masterClient.on(Event.CUSTOM_EVENT, event => {
      const eventId = event.eventId;
      if (eventId === 'answerOptionClicked') {
          answerOptionClicked(event);
      }
    });

    this.masterClient.on(Event.ROOM_CUSTOM_PROPERTIES_CHANGED, (data)=> {
      // 题目索引有变动时，显示新的题目
      if ('currentQuestionIndex' in data.changedProps && data.changedProps.currentQuestionIndex !== 0) {
        this.broadcast('nextRound');
        return;
      }
      
      console.log(data.changedProps);
      
      // 更新成绩时，检查俩人是否已经答题结束
      if ('playerData' in data.changedProps){
        console.log('检查下一局');
        const roundOver = ifRoundOver();
        if (roundOver) {
          this.broadcast('showRoundOverUI');
          nextRound();
        }
        return;
      };
    })
  
    const nextRound = () =>{

      setTimeout(() => {
        // 重置选项
        const currentOption = -1;
        const updateRoomProps: {[key: string]: any} = {};
        for (let i = 0; i < this.players.length; i++) {
          const player = this.players[i];
          updateRoomProps.playerData = this.room.getCustomProperties().playerData;
          updateRoomProps.playerData[player.actorId].currentOption = currentOption;
        }

        this.room.setCustomProperties(updateRoomProps);

        // 进入下一题
        if (this.room.getCustomProperties().currentQuestionIndex + 1 < this.room.getCustomProperties().questions.length) {
          let currentQuestionIndex = this.room.getCustomProperties().currentQuestionIndex;
          currentQuestionIndex ++;
          this.room.setCustomProperties({currentQuestionIndex});
        } else {
          this.broadcast('gameOver');
        }
      }, 1000);  
    };
   

    const answerOptionClicked = (event: any) => {
      const optionIndex = event.eventData.userOptionIndex;
                
      // 计算分数
      // const score = this.calculateScore(this.currentQuestion.answerIndex, optionIndex);
      const score = 100;
      console.log(this.room.getCustomProperties().playerData);
      console.log(event.senderId);
      const newScore = this.room.getCustomProperties().playerData[(event.senderId)].score + score;
      // const actorPlayer = this.room.getPlayer(event.senderId);
      // const newScore = actorPlayer.getCustomProperties().score + score;
      
      const currentQuestionIndex = this.room.getCustomProperties().currentQuestionIndex;
      const currentQuestion = this.room.getCustomProperties().questions[currentQuestionIndex]
      const actorOptionResult = {
          score: newScore,
          correctIndex: currentQuestion.answerIndex,
          currentOption: optionIndex,
      }
      
      // 告诉事件发起者答案
      this.masterClient.sendEvent('actorOptionResult', actorOptionResult, {targetActorIds: [event.senderId]});

      // 存储事件发起者的答案
      const currentOption = optionIndex;
      const actorPlayerId = event.senderId;
      
      const updateRoomProps: {[key: string]: any} = {};
      updateRoomProps.playerData = this.room.getCustomProperties().playerData;
      updateRoomProps.playerData[actorPlayerId] = {
        score: newScore,
        currentOption,
      };
      console.log('存储当前玩家的结果');
      console.log(updateRoomProps.playerData);
      this.room.setCustomProperties(updateRoomProps);
      
      // 告诉其他人分数
      this.forwardToTheRests(event, (eventData) => { 
        const optionResult = {
          score: newScore,
          actorPlayerId: event.senderId,
        };
        return optionResult;
      }, 'optionResult')
    };

    const ifRoundOver = () => {
      const answerPlayerCount = this.players.reduce((total, player) => {
        console.log(this.room.getCustomProperties());
        const playerData = this.room.getCustomProperties().playerData[player.actorId];
        const playerOption = playerData.currentOption;
        if (playerOption !== -1) {
            return total + 1;
        };
        return total + 0;

      }, 0);

      console.log('当前的答题人数 ');
      console.log(answerPlayerCount);

      // 所有人都答题了，向所有人展示当前题目结果
      if (answerPlayerCount === this.players.length) {
        return true;
      }
      return false;
    };



  }

  private getMultiplayerQuestions = async () => {
      var qidQuery = new AV.Query('Question');
      // 取随机数的边界
      qidQuery.descending('qid');
      qidQuery.limit(1);
      return await qidQuery.first().then((question) => {
        var qid = question.get('qid');
        var randomNumbers = this.getRandomNumbers(qid, 3);
        var questionQuery = new AV.Query('Question');
        questionQuery.containedIn('qid', randomNumbers);
        return questionQuery.find();
      });
    }

    private getRandomNumbers = (max: any, count: any) => {
      var randomNumbers = [];
      while (randomNumbers.length < count) {
        var randomNumber = Math.floor(Math.random() * max + 1);
        console.log('randomNumber is ' + randomNumber);
        if ( randomNumbers.indexOf(randomNumber) == -1) {
          randomNumbers.push(randomNumber);
        }
      }
      return randomNumbers;
    };


}
