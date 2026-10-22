/*
 * AUTO-GENERATED (Admin GAS) — DO NOT EDIT.
 * 正本: baseball/gas/baseball_uniform_survey/survey.schema.json, src/survey-core.js, src/survey-aggregate.js, src/snapshot-store.js, src/survey-analysis.js（Admin 専用）
 * 再生成: (baseball/gas/baseball_uniform_survey で) npm run build
 * CIは `npm run build:check` で生成物との差分を検出する。
 */
var SURVEY_SCHEMA = {"survey_id":"nagoya_baseball_uniform_club_2026","survey_version":"2026-10","schema_version":"1","design_version":"2.18","title":"名古屋野球ユニ部アンケート","target":"18歳以上","privacyNotice":"回答は個人単位では公開せず、公開ページでは集計結果のみを表示します。自由記述・詳細な居住地域・回答を区別するための記号は公開しません。個別回答は運営責任者1名が集計・運営改善目的で確認する場合があります。匿名性を優先するため、送信後に特定の回答を本人確認して修正・削除することは原則できません。","purpose":["スポーツユニフォーム嗜好とスポーツ経験の関係を把握する","好きなスポーツユニフォームと、その競技の実経験の一致・不一致を直接把握する","名古屋野球ユニ部への関心、短期参加意向、未参加障壁を把握する","参加経験者の満足度、参加頻度低下の理由、再参加条件を把握する","開催内容・時間帯・人数・価格受容・告知方法のニーズを把握する","運動を継続・再開するモチベーションを把握し公開単純集計する"],"semantics":{"stableIds":"question.id / option.id を保存値の正本とし、表示labelは保存値に使用しない","other":"option.other=true の場合のみ other_texts[question_id] を受理し選択時は必須。非選択時の自由記述は送信不可","exclusive":"option.exclusive=true は同一設問の他optionと同時選択不可","dynamic":"single_dynamic は sourceQuestion の選択済みoption IDを再利用し、自由記述本文をoption IDにしない","showIfOperators":["equals","notEquals","in","contains","notContains","hasAnyExcept","all","any","conditionRef"],"hiddenFields":"showIfを満たさない設問の値はクライアントで破棄し、サーバーでもhidden_fieldとして拒否","scale":{"type":"scale","min":1,"max":5,"anchors":{"1":"不満","2":"やや不満","3":"どちらともいえない","4":"やや満足","5":"満足"},"notApplicable":{"id":"cannot_rate","label":"評価できない"}},"otherTextsMaxLengthDefault":150},"barrierCodes":{"schedule":{"label":"日程・時間","definition":"開催曜日・時間帯など開催日時そのものが合わない","boundary":"『土曜開催だから無理』はschedule。生活全体が忙しい場合はwork_life"},"work_life":{"label":"仕事・生活事情","definition":"仕事・学業・家庭・介護・他予定などで時間を確保できない","boundary":"開催日時そのものより生活事情が主因"},"location":{"label":"場所・移動","definition":"開催地・交通・距離の問題"},"cost":{"label":"費用","definition":"参加費・交通費など金銭負担"},"physical_ability":{"label":"体力・運動への自信","definition":"運動能力・体力・運動が苦手であることへの不安"},"health_injury":{"label":"体調・ケガ","definition":"体調、持病、ケガなど健康面の理由"},"weather_environment":{"label":"天候・環境","definition":"暑さ・寒さ・雨・風など屋外環境の問題"},"skill_level":{"label":"経験・レベル差","definition":"競技経験や技能レベルへの不安・不一致"},"relationships":{"label":"人間関係","definition":"常連の輪、知人不在、特定参加者との関係","boundary":"『常連の輪に入りにくそう』はrelationships。場全体のノリはatmosphere"},"atmosphere":{"label":"場の雰囲気","definition":"場全体の文化・ノリ・コミュニケーションスタイル","boundary":"人間関係そのものではなく全体の文化やテンションが主因"},"participant_info_uncertainty":{"label":"参加者情報不足","definition":"参加者層・人数・経験者比率等が事前に分からないことへの不安"},"age":{"label":"年齢","definition":"自分の年齢、参加者の年齢層、年齢条件への不安"},"body_image":{"label":"体型・見た目","definition":"体型、見た目、身体露出等への不安"},"sexuality_identity":{"label":"性的指向・身元の推測","definition":"性的指向やコミュニティ参加が周囲に知られる・推測される不安"},"community_scope_fit":{"label":"コミュニティ対象との適合","definition":"ゲイ・男性同性愛者向け等の対象設定そのものが自分に合うか"},"sexual_atmosphere_contact":{"label":"性的な雰囲気・身体接触","definition":"性的な雰囲気、性的な誘い、身体接触、距離感への不安"},"boundary_safety":{"label":"拒否・同意のしやすさ","definition":"嫌なことを断れるか、同意や境界が尊重されるかへの不安"},"solo_participation":{"label":"一人参加","definition":"一人で参加する・続けることへの負担"},"equipment":{"label":"用具・ユニフォーム","definition":"必要な道具や衣装を持っていない"},"privacy_photo":{"label":"写真・SNS","definition":"撮影、顔出し、写真掲載、SNS掲載への不安"},"rules_uncertainty":{"label":"ルール・流れ不明","definition":"競技ルール、参加ルール、当日の流れが分からない"},"interest_change":{"label":"興味の変化","definition":"以前あった関心が下がった・他へ移った"},"no_interest":{"label":"関心なし","definition":"対象活動に現時点で関心がない"},"motivation":{"label":"動機低下","definition":"興味はあるが行動する気力・きっかけが弱い"},"life_transition":{"label":"生活段階の変化","definition":"進学・卒業・就職等で従来の活動環境が終了した"},"content_fit":{"label":"内容との適合","definition":"活動内容・構成・スポーツ/交流/撮影の配分が期待と合わない"}},"sportCodePolicy":"ユニフォーム・学生活動・成人後スポーツの対応関係はoption.sportCodeで集計する","analysisFunnels":{"nonattendee_conversion":{"population":{"club_awareness":["aware_not_attended","name_only","first_time"]},"stages":[{"question":"catchball_interest","pass":["very_interested","if_conditions","some_interest"]},{"question":"near_term_participation_intent","pass":["definitely","if_conditions"]},{"question":"barriers","role":"barrier_breakdown"},{"question":"participation_conditions","role":"conversion_conditions"},{"question":"participation_fee_tolerance","role":"price_acceptance"}],"denominator":"stage_reached"},"attendee_retention":{"population":{"club_awareness":["attended"]},"stages":[{"question":"attendance_count","role":"participation_depth"},{"question":"last_attended","role":"recency"},{"question":"repeat_intent","pass":["definitely","if_conditions"]},{"question":"attendance_lapse_reasons","role":"lapse_barriers"},{"question":"rejoin_conditions","role":"return_conditions"}],"denominator":"attendee_population"},"past_to_current_barriers":{"method":"question optionのbarrierCodeを使い、activity_stopped_reasons / barriers / pre_attendance_worries / attendance_lapse_reasons を共通コードで比較する。専用の重複質問は置かない"},"uniform_to_sport":{"population":{"top_uniform":["baseball","soccer","basketball","volleyball","rugby","american_football","track_field","racing_briefs","swimwear_other","wrestling_singlet","gymnastics","tennis","table_tennis","badminton","martial_arts","ice_hockey","cycling"]},"stages":[{"question":"favorite_uniforms","role":"uniform_interest"},{"question":"top_uniform","role":"primary_uniform"},{"question":"top_uniform_sport_experience","role":"direct_experience_match","experienced":["continuous","casual","trial_only"],"no_experience":["none"]},{"question":"uniform_engagement","role":"engagement_style"}],"derivedMetrics":["favorite_uniform_sport_experienced_rate","favorite_uniform_sport_no_experience_rate","continuous_experience_rate"],"note":"学生活動・成人後スポーツのsportCodeクロスは補助分析。競技分類粒度が異なるため、主指標はtop_uniform_sport_experienceを使用する。"},"participation_environment":{"population":"operations_questions_reached","stages":[{"question":"preferred_size","role":"group_size"},{"question":"age_limit_effect","role":"age_restriction_effect"},{"question":"participation_fee_tolerance","role":"price_acceptance"}],"denominator":"question_reached"}},"adminAnalysis":{"purpose":"Admin専用の分析定義（Issue #440）。ファネルの条件は analysisFunnels を正本とし、ここには表示ラベルとクロス集計の組だけを置く。Public / snapshot / publication には使わない。","funnelLabels":{"nonattendee_conversion":"未参加者の転換","attendee_retention":"参加経験者の継続","uniform_to_sport":"ユニフォーム好き → 競技経験","participation_environment":"参加環境（運営設問の到達者）"},"roleLabels":{"barrier_breakdown":"障壁の内訳","conversion_conditions":"参加の条件","price_acceptance":"価格受容","participation_depth":"参加回数","recency":"最終参加時期","lapse_barriers":"参加が減った理由","return_conditions":"再参加の条件","uniform_interest":"好きなユニフォーム","primary_uniform":"最も好きなユニフォーム","direct_experience_match":"その競技の経験","engagement_style":"ユニフォームとの関わり方","group_size":"希望人数","age_restriction_effect":"年齢制限の影響"},"denominatorLabels":{"stage_reached":"各段階に到達した人","attendee_population":"参加経験者全体","question_reached":"その設問に到達した人"},"crossTabs":[{"id":"top_uniform_x_sport_experience","label":"最も好きなユニフォーム × その競技の経験","row":"top_uniform","column":"top_uniform_sport_experience","purpose":"好きなユニフォームと実際の競技経験の一致・不一致（主分析）"},{"id":"baseball_experience_x_catchball_interest","label":"野球経験 × キャッチボール関心","row":"baseball_experience","column":"catchball_interest","purpose":"野球経験の有無・深さと現在のキャッチボール関心"},{"id":"club_awareness_x_near_term_intent","label":"認知・参加経験 × 短期参加意向","row":"club_awareness","column":"near_term_participation_intent","purpose":"認知・参加経験段階と短期参加意向"},{"id":"age_x_near_term_intent","label":"年代 × 短期参加意向","row":"age","column":"near_term_participation_intent","purpose":"年代別の短期需要"},{"id":"barriers_x_age","label":"参加障壁 × 年代","row":"barriers","column":"age","purpose":"障壁ごとの年代内訳（複数選択のため障壁へ重複計上）"},{"id":"fee_tolerance_x_near_term_intent","label":"価格受容 × 短期参加意向","row":"participation_fee_tolerance","column":"near_term_participation_intent","purpose":"価格受容と参加意向"},{"id":"preferred_schedule_x_near_term_intent","label":"開催希望時間帯 × 短期参加意向","row":"preferred_schedule","column":"near_term_participation_intent","purpose":"開催希望時間帯と参加意向（複数選択のため時間帯へ重複計上）"},{"id":"attendance_count_x_repeat_intent","label":"参加回数 × 再参加意向","row":"attendance_count","column":"repeat_intent","purpose":"参加経験者のみ。参加回数と再参加意向"},{"id":"last_attended_x_repeat_intent","label":"最終参加時期 × 再参加意向","row":"last_attended","column":"repeat_intent","purpose":"参加経験者のみ。最終参加時期と再参加意向"}]},"implementationNotes":["公開設定の唯一の正本は各question.publication。tier別の設問ID重複リストを持たない。","ordinal=trueの設問はschema順で公開し、0件optionも表示する。ordinal=falseの名義尺度のみ件数降順にできる。","すべての公開集計にminCell=3を適用し、small cellは補完秘匿または統合で逆算を防ぐ。","分岐設問はminTargetを満たした場合のみ公開する。参加経験者のsensitive branchはminTarget=20、それ以外の公開branchは原則10。","総回答数は10件未満では数値を出さず、10件以上は10件単位に丸める。","public resultは回答ごとに更新せずbatch snapshotで更新し、cache切替もsnapshot更新時だけ行う。","地域公開はprefecture option IDを地方blockへ再集約し、少数地域は『その他の地域』へ統合して補完秘匿する。","semanticCodesはoptionごとにprimary/secondary[]を付与し、code集計は回答者単位で重複なく数える。","source_channelはserver allowlistを通してprivate保存し、個人識別的なcampaign codeは禁止する。","respondentNotice.retention.statusがmust_set_before_launchのままなら本番公開不可。","進捗表示はvisible_route_questionsを分母に計算し、全体の最長routeを分母にしない。","進捗・section名・route名はUI内だけで使用し、GA4へ送らない。","catchball_interestがlow_interest/not_interestedの未参加者は、uniform_social_interestの1問だけ拾った後、運営条件・活動歴をほぼスキップしてプロフィールへ進む。","low-interest選択後は肯定メッセージを表示し、回答自体に価値があることを伝える。","所要時間は固定値ではなく『5〜12分程度』の幅で表示する。","短縮routeでも、全層に関係するexercise_frequencyとexercise_motivationは共通設問として残し、単純集計公開の対象とする。","exercise_continuation_motivationはexercise_frequency != noneの回答者だけに表示し、現在運動している人の実際の継続要因を測る。exercise_motivationは全回答者に残し、継続・再開の将来要因を測る。","catchball_interestは5段階（very_interested / if_conditions / some_interest / low_interest / not_interested）で統一し、uniform_social_interest・低関心メッセージ・pure_uniform_short_routeの参照IDと一致させる。"],"questions":[{"id":"age_confirmed","section":"eligibility","label":"18歳以上ですか","type":"single","required":true,"options":[{"id":"yes","label":"はい"},{"id":"no","label":"いいえ"}],"maxLength":null,"termination":{"when":"no","status":"ineligible"},"publication":{"visibility":"private"}},{"id":"favorite_uniforms","section":"uniform","label":"好きなスポーツユニフォームをすべて選んでください","type":"multiple","required":true,"options":[{"id":"baseball","label":"野球","sportCode":"baseball"},{"id":"soccer","label":"サッカー","sportCode":"soccer"},{"id":"basketball","label":"バスケットボール","sportCode":"basketball"},{"id":"volleyball","label":"バレーボール","sportCode":"volleyball"},{"id":"rugby","label":"ラグビー","sportCode":"rugby"},{"id":"american_football","label":"アメリカンフットボール","sportCode":"american_football"},{"id":"track_field","label":"陸上競技","sportCode":"track_field"},{"id":"racing_briefs","label":"競パン","sportCode":"swimming"},{"id":"swimwear_other","label":"水泳・競泳ウェア（競パン以外）","sportCode":"swimming"},{"id":"wrestling_singlet","label":"レスリング・シングレット","sportCode":"wrestling"},{"id":"gymnastics","label":"体操競技","sportCode":"gymnastics"},{"id":"tennis","label":"テニス","sportCode":"tennis"},{"id":"table_tennis","label":"卓球","sportCode":"table_tennis"},{"id":"badminton","label":"バドミントン","sportCode":"badminton"},{"id":"martial_arts","label":"柔道・剣道などの武道","sportCode":"martial_arts"},{"id":"ice_hockey","label":"アイスホッケー","sportCode":"ice_hockey"},{"id":"cycling","label":"自転車・サイクリングウェア","sportCode":"cycling"},{"id":"training_wear","label":"ジャージ・トレーニングウェア","sportCode":"training"},{"id":"school_gym_wear","label":"学校体操服","sportCode":"school_gym"},{"id":"other","label":"その他","other":true},{"id":"none","label":"特に強く惹かれるスポーツユニフォームはない","exclusive":true}],"maxLength":null,"otherMaxLength":100,"publication":{"visibility":"public","tier":"bias_sensitive","minTotal":30,"minTarget":10,"minCell":3,"sensitiveBranch":false,"ordinal":false,"sort":"count_desc","tieBreak":"schema_option_order","showZeroCells":false,"denominator":"question_reached"}},{"id":"top_uniform","section":"uniform","label":"その中で最も好きなものを1つ選んでください","type":"single_dynamic","required":true,"sourceQuestion":"favorite_uniforms","reuseOptionIds":true,"autoSelectIfSingle":true,"maxLength":null,"excludeOptionIds":["none"],"showIf":{"question":"favorite_uniforms","hasAnyExcept":["none"]},"publication":{"visibility":"public","tier":"bias_sensitive","minTotal":30,"minTarget":10,"minCell":3,"sensitiveBranch":false,"ordinal":false,"sort":"count_desc","tieBreak":"schema_option_order","showZeroCells":false,"denominator":"question_reached"}},{"id":"uniform_appeal","section":"uniform","label":"スポーツユニフォームのどこに魅力を感じますか","type":"multiple","required":true,"options":[{"id":"design_color","label":"デザイン・色"},{"id":"silhouette","label":"シルエット・身体のライン"},{"id":"material_touch","label":"素材・肌触り"},{"id":"smooth_texture","label":"サラサラ・滑らかな肌触り"},{"id":"stretch_fit","label":"ストレッチ性・フィット感"},{"id":"pants_fit_tension","label":"野球パンツのフィット感・張り"},{"id":"thin_sheer","label":"薄手・軽さ・透け感"},{"id":"thick_solid","label":"厚手・しっかりした生地感"},{"id":"sweat_feel","label":"汗をかいた時の感触・濡れ感"},{"id":"undershirt","label":"アンダーシャツとの重ね着感"},{"id":"team_identity","label":"チームや部活の一体感"},{"id":"athletic_atmosphere","label":"部活・学校野球のような体育会の雰囲気"},{"id":"nostalgia","label":"学生時代の思い出"},{"id":"athlete_admiration","label":"競技・選手への憧れ"},{"id":"other","label":"その他","other":true},{"id":"none","label":"特に強い魅力は感じない","exclusive":true}],"maxLength":null,"otherMaxLength":100,"publication":{"visibility":"public","tier":"bias_sensitive","minTotal":30,"minTarget":10,"minCell":3,"sensitiveBranch":false,"ordinal":false,"sort":"count_desc","tieBreak":"schema_option_order","showZeroCells":false,"denominator":"question_reached"}},{"id":"uniform_engagement","section":"uniform","label":"好きなスポーツユニフォームと、どのように関わりたいですか","type":"multiple","required":true,"options":[{"id":"wear","label":"自分で着たい"},{"id":"see_others","label":"人が着ている姿を見たい"},{"id":"photograph","label":"撮る側として関わりたい"},{"id":"have_photos_taken","label":"着た姿を撮ってもらいたい"},{"id":"sport_activity","label":"そのユニフォームで競技・運動をしたい"},{"id":"collect","label":"集めたり眺めたりして楽しみたい"},{"id":"none","label":"今のところ特に当てはまらない","exclusive":true}],"maxLength":null,"publication":{"visibility":"public","tier":"bias_sensitive","minTotal":30,"minTarget":10,"minCell":3,"sensitiveBranch":false,"ordinal":false,"sort":"count_desc","tieBreak":"schema_option_order","showZeroCells":false,"denominator":"question_reached"}},{"id":"top_uniform_sport_experience","section":"uniform","label":"最も好きなユニフォームの競技を、実際に経験したことはありますか","type":"single","required":true,"showIf":{"question":"top_uniform","in":["baseball","soccer","basketball","volleyball","rugby","american_football","track_field","racing_briefs","swimwear_other","wrestling_singlet","gymnastics","tennis","table_tennis","badminton","martial_arts","ice_hockey","cycling"]},"options":[{"id":"continuous","label":"部活・クラブ・チームなどで継続して経験したことがある"},{"id":"casual","label":"何度かやったことがある（授業・遊び・個人など）"},{"id":"trial_only","label":"1〜2回体験した程度"},{"id":"none","label":"経験したことはない"}],"maxLength":null,"publication":{"visibility":"public","tier":"early_factual","minTotal":10,"minTarget":10,"minCell":3,"sensitiveBranch":false,"ordinal":true,"showZeroCells":true,"denominator":"question_reached"}},{"id":"baseball_play_interest","section":"club","label":"野球・キャッチボールをすること自体に、どの程度関心がありますか","type":"single","required":true,"options":[{"id":"currently_do","label":"現在している"},{"id":"very_interested","label":"ぜひしてみたい"},{"id":"if_opportunity","label":"機会があればしてみたい"},{"id":"little_interest","label":"あまり興味はない"},{"id":"no_interest","label":"興味はない"}],"maxLength":null,"publication":{"visibility":"public","tier":"bias_sensitive","minTotal":30,"minTarget":10,"minCell":3,"sensitiveBranch":false,"ordinal":true,"showZeroCells":true,"denominator":"question_reached"}},{"id":"baseball_experience","section":"club","label":"野球・キャッチボールの経験について、最も近いものを1つ選んでください","type":"single","required":true,"options":[{"id":"team","label":"野球部・競技チーム経験あり"},{"id":"grass_baseball","label":"草野球経験あり"},{"id":"catchball_only","label":"キャッチボールを何度かしたことがある"},{"id":"class_play","label":"授業・遊びなどで野球を何度かしたことがある"},{"id":"none","label":"未経験"}],"maxLength":null,"publication":{"visibility":"public","tier":"early_factual","minTotal":10,"minTarget":10,"minCell":3,"sensitiveBranch":false,"ordinal":true,"showZeroCells":true,"denominator":"question_reached"}},{"id":"club_awareness","section":"club","label":"名古屋野球ユニ部を知っていますか","type":"single","required":true,"options":[{"id":"attended","label":"参加したことがある"},{"id":"aware_not_attended","label":"知っているが未参加"},{"id":"name_only","label":"名前だけ知っている"},{"id":"first_time","label":"今回初めて知った"}],"maxLength":null,"publication":{"visibility":"public","tier":"early_factual","minTotal":10,"minTarget":10,"minCell":3,"sensitiveBranch":false,"ordinal":true,"showZeroCells":true,"denominator":"question_reached"}},{"id":"catchball_interest","section":"nonattendee","label":"野球ユニフォームを着てキャッチボールをする交流会に、どの程度興味がありますか","type":"single","required":true,"showIf":{"question":"club_awareness","in":["aware_not_attended","name_only","first_time"]},"options":[{"id":"very_interested","label":"ぜひ参加してみたい"},{"id":"if_conditions","label":"条件が合えば参加してみたい"},{"id":"some_interest","label":"少し興味がある"},{"id":"low_interest","label":"今のところ興味は薄い"},{"id":"not_interested","label":"今のところ参加したいとは思わない"}],"maxLength":null,"publication":{"visibility":"public","tier":"bias_sensitive","minTotal":30,"minTarget":10,"minCell":3,"sensitiveBranch":false,"ordinal":true,"showZeroCells":true,"denominator":"question_reached"}},{"id":"uniform_social_interest","label":"キャッチボールをしなくても、野球ユニフォームを着る・見る・撮ることを中心にした交流には興味がありますか","type":"single","required":true,"options":[{"id":"very_interested","label":"ぜひ参加してみたい"},{"id":"if_conditions","label":"内容や雰囲気が合えば興味がある"},{"id":"some_interest","label":"少し興味がある"},{"id":"low_interest","label":"今のところ興味は薄い"},{"id":"not_interested","label":"今のところ興味はない"}],"showIf":{"all":[{"question":"club_awareness","in":["aware_not_attended","name_only","first_time"]},{"question":"catchball_interest","in":["low_interest","not_interested"]}]},"analysisUse":"キャッチボール参加意向が低いが、野球ユニフォームそのものを着る・見る・撮る交流には関心がある層を把握する","publication":{"visibility":"public","tier":"bias_sensitive","minTotal":30,"minTarget":10,"minCell":3,"sensitiveBranch":false,"ordinal":true,"showZeroCells":true,"denominator":"question_reached"},"section":"club_interest"},{"id":"near_term_participation_intent","section":"nonattendee","label":"今後3か月以内に、実際にキャッチボール会へ参加する可能性はどの程度ありますか","type":"single","required":true,"showIf":{"all":[{"question":"club_awareness","in":["aware_not_attended","name_only","first_time"]},{"question":"catchball_interest","in":["very_interested","if_conditions","some_interest"]}]},"options":[{"id":"definitely","label":"参加する可能性が高い"},{"id":"if_conditions","label":"日程や条件が合えば参加する可能性がある"},{"id":"unsure","label":"まだ分からない"},{"id":"not_now","label":"当面は参加する予定はない"}],"maxLength":null,"publication":{"visibility":"public","tier":"bias_sensitive","minTotal":30,"minTarget":10,"minCell":3,"sensitiveBranch":false,"ordinal":true,"showZeroCells":true,"denominator":"question_reached"}},{"id":"barriers","section":"nonattendee","label":"参加をためらう点・気になる点を選んでください","type":"multiple","required":true,"showIf":{"all":[{"question":"club_awareness","in":["aware_not_attended","name_only","first_time"]},{"question":"catchball_interest","in":["very_interested","if_conditions","some_interest"]}]},"options":[{"id":"exercise_not_confident","label":"運動が苦手・体力に自信がない","semanticCodes":{"primary":"physical_ability","secondary":[]}},{"id":"health_concern","label":"体調やケガが心配","semanticCodes":{"primary":"health_injury","secondary":[]}},{"id":"skill_anxiety","label":"経験者についていけるか不安","semanticCodes":{"primary":"skill_level","secondary":[]}},{"id":"rules_unknown","label":"野球やキャッチボールのルール・進め方が分からない","semanticCodes":{"primary":"rules_uncertainty","secondary":[]}},{"id":"solo","label":"一人で参加しづらい","semanticCodes":{"primary":"solo_participation","secondary":[]}},{"id":"regulars","label":"常連の輪に入りにくそうで不安","semanticCodes":{"primary":"relationships","secondary":["atmosphere"]}},{"id":"participants_unknown","label":"どんな参加者が来るか分からない","semanticCodes":{"primary":"participant_info_uncertainty","secondary":[]}},{"id":"age_fit","label":"参加者の年齢層に自分が合うか不安","semanticCodes":{"primary":"age","secondary":[]}},{"id":"body_fit","label":"体型や見た目が場に合うか不安","semanticCodes":{"primary":"body_image","secondary":[]}},{"id":"sexual_atmosphere","label":"性的な雰囲気や望まない身体接触がないか不安","semanticCodes":{"primary":"sexual_atmosphere_contact","secondary":[]}},{"id":"hard_to_refuse","label":"嫌なことを断りにくそうで不安","semanticCodes":{"primary":"boundary_safety","secondary":[]}},{"id":"photo_privacy","label":"写真を撮られること・SNS掲載・身バレが不安","semanticCodes":{"primary":"privacy_photo","secondary":["sexuality_identity"]}},{"id":"no_uniform","label":"ユニフォームを持っていない","semanticCodes":{"primary":"equipment","secondary":[]}},{"id":"no_glove","label":"グローブを持っていない","semanticCodes":{"primary":"equipment","secondary":[]}},{"id":"location","label":"開催場所が遠い・行きにくい","semanticCodes":{"primary":"location","secondary":[]}},{"id":"schedule","label":"開催日時が合わない","semanticCodes":{"primary":"schedule","secondary":[]}},{"id":"cost","label":"参加費や交通費などの費用が気になる","semanticCodes":{"primary":"cost","secondary":[]}},{"id":"weather","label":"暑さ・寒さ・雨など屋外環境が心配","semanticCodes":{"primary":"weather_environment","secondary":[]}},{"id":"work_life","label":"仕事・学業・私生活が忙しく、時間を作りにくい","semanticCodes":{"primary":"work_life","secondary":[]}},{"id":"community_scope","label":"ゲイ・男性同性愛者向けの場であることが自分に合うか気になる","semanticCodes":{"primary":"community_scope_fit","secondary":[]}},{"id":"other","label":"その他","other":true},{"id":"none","label":"特にない","exclusive":true}],"maxLength":null,"otherMaxLength":150,"publication":{"visibility":"public","tier":"bias_sensitive","minTotal":30,"minTarget":10,"minCell":3,"sensitiveBranch":false,"ordinal":false,"sort":"count_desc","tieBreak":"schema_option_order","showZeroCells":false,"denominator":"question_reached"}},{"id":"main_barrier","section":"nonattendee","label":"その中で最も大きな理由を1つ選んでください","type":"single_dynamic","required":true,"sourceQuestion":"barriers","excludeOptionIds":["none"],"reuseOptionIds":true,"autoSelectIfSingle":true,"showIf":{"all":[{"question":"club_awareness","in":["aware_not_attended","name_only","first_time"]},{"question":"catchball_interest","in":["very_interested","if_conditions","some_interest"]},{"question":"barriers","hasAnyExcept":["none"]}]},"maxLength":null,"publication":{"visibility":"public","tier":"bias_sensitive","minTotal":30,"minTarget":10,"minCell":3,"sensitiveBranch":false,"ordinal":false,"sort":"count_desc","tieBreak":"schema_option_order","showZeroCells":false,"denominator":"question_reached"}},{"id":"participation_conditions","section":"nonattendee","label":"どんな条件があれば参加しやすくなりますか","type":"multiple","required":true,"showIf":{"all":[{"question":"club_awareness","in":["aware_not_attended","name_only","first_time"]},{"question":"catchball_interest","in":["very_interested","if_conditions","some_interest"]}]},"options":[{"id":"beginner_welcome","label":"初心者歓迎が明確","reassuranceFor":["skill_level","physical_ability","rules_uncertainty"]},{"id":"participant_info","label":"参加者の雰囲気が事前に分かる","reassuranceFor":["participant_info_uncertainty","relationships","atmosphere"]},{"id":"newcomers_present","label":"初参加者や久しぶりの参加者が複数いる","reassuranceFor":["relationships","solo_participation"]},{"id":"glove_rental","label":"グローブの貸出がある","reassuranceFor":["equipment"]},{"id":"uniform_rental","label":"ユニフォームの貸出がある","reassuranceFor":["equipment"]},{"id":"small_group","label":"少人数開催","reassuranceFor":["relationships","atmosphere"]},{"id":"with_friend","label":"知人と参加できる","reassuranceFor":["solo_participation"]},{"id":"schedule_match","label":"開催日時が合う","reassuranceFor":["schedule"]},{"id":"near_location","label":"開催場所が近い・行きやすい","reassuranceFor":["location"]},{"id":"no_photo_option","label":"写真に写らない・SNS掲載しない選択ができる","reassuranceFor":["privacy_photo","sexuality_identity"]},{"id":"safe_policy","label":"健全な運営方針や身体接触のルールが明記されている","reassuranceFor":["sexual_atmosphere_contact","boundary_safety"]},{"id":"price_clear","label":"参加費が事前に分かる","reassuranceFor":["cost"]},{"id":"other","label":"その他","other":true},{"id":"none","label":"特にない・まだ分からない","exclusive":true}],"maxLength":null,"otherMaxLength":150,"publication":{"visibility":"public","tier":"bias_sensitive","minTotal":30,"minTarget":10,"minCell":3,"sensitiveBranch":false,"ordinal":false,"sort":"count_desc","tieBreak":"schema_option_order","showZeroCells":false,"denominator":"question_reached"}},{"id":"attendance_count","section":"attendee","label":"名古屋野球ユニ部にこれまで何回参加しましたか","type":"single","required":true,"showIf":{"question":"club_awareness","equals":"attended"},"options":[{"id":"once","label":"1回"},{"id":"two_to_four","label":"2〜4回"},{"id":"five_plus","label":"5回以上"}],"maxLength":null,"publication":{"visibility":"private"}},{"id":"last_attended","section":"attendee","label":"最後に参加したのはいつ頃ですか","type":"single","required":true,"showIf":{"question":"club_awareness","equals":"attended"},"options":[{"id":"within_3m","label":"3か月以内"},{"id":"three_to_six_m","label":"3〜6か月前"},{"id":"six_to_twelve_m","label":"6か月〜1年前"},{"id":"over_1y","label":"1年以上前"},{"id":"dont_remember","label":"覚えていない"}],"maxLength":null,"publication":{"visibility":"private"}},{"id":"repeat_intent","section":"attendee","label":"今後3か月以内に、また参加したいと思いますか","type":"single","required":true,"showIf":{"question":"club_awareness","equals":"attended"},"options":[{"id":"definitely","label":"ぜひ参加したい"},{"id":"if_conditions","label":"条件が合えば参加したい"},{"id":"unsure","label":"まだ分からない"},{"id":"not_now","label":"当面は参加する予定はない"}],"maxLength":null,"publication":{"visibility":"public","tier":"bias_sensitive","minTotal":30,"minTarget":20,"minCell":3,"sensitiveBranch":true,"ordinal":true,"showZeroCells":true,"denominator":"question_reached"}},{"id":"overall_satisfaction","section":"attendee","label":"名古屋野球ユニ部の総合満足度を教えてください","type":"scale","min":1,"max":5,"anchors":{"1":"不満","2":"やや不満","3":"どちらともいえない","4":"やや満足","5":"満足"},"notApplicable":{"id":"cannot_rate","label":"評価できない"},"required":true,"showIf":{"question":"club_awareness","equals":"attended"},"maxLength":null,"publication":{"visibility":"public","tier":"bias_sensitive","minTotal":30,"minTarget":20,"minCell":3,"sensitiveBranch":true,"ordinal":true,"showZeroCells":true,"denominator":"question_reached"}},{"id":"satisfaction_atmosphere","section":"attendee","label":"参加者や場の雰囲気の満足度を教えてください","type":"scale","min":1,"max":5,"anchors":{"1":"不満","2":"やや不満","3":"どちらともいえない","4":"やや満足","5":"満足"},"notApplicable":{"id":"cannot_rate","label":"評価できない"},"required":true,"showIf":{"question":"club_awareness","equals":"attended"},"maxLength":null,"publication":{"visibility":"public","tier":"bias_sensitive","minTotal":30,"minTarget":20,"minCell":3,"sensitiveBranch":true,"ordinal":true,"showZeroCells":true,"denominator":"question_reached"}},{"id":"satisfaction_beginner_support","section":"attendee","label":"初心者・久しぶりの参加者への配慮の満足度を教えてください","type":"scale","min":1,"max":5,"anchors":{"1":"不満","2":"やや不満","3":"どちらともいえない","4":"やや満足","5":"満足"},"notApplicable":{"id":"cannot_rate","label":"評価できない"},"required":true,"showIf":{"question":"club_awareness","equals":"attended"},"maxLength":null,"publication":{"visibility":"public","tier":"bias_sensitive","minTotal":30,"minTarget":20,"minCell":3,"sensitiveBranch":true,"ordinal":true,"showZeroCells":true,"denominator":"question_reached"}},{"id":"satisfaction_activity","section":"attendee","label":"キャッチボール・運動量など活動内容の満足度を教えてください","type":"scale","min":1,"max":5,"anchors":{"1":"不満","2":"やや不満","3":"どちらともいえない","4":"やや満足","5":"満足"},"notApplicable":{"id":"cannot_rate","label":"評価できない"},"required":true,"showIf":{"question":"club_awareness","equals":"attended"},"maxLength":null,"publication":{"visibility":"public","tier":"bias_sensitive","minTotal":30,"minTarget":20,"minCell":3,"sensitiveBranch":true,"ordinal":true,"showZeroCells":true,"denominator":"question_reached"}},{"id":"pre_attendance_worries","section":"attendee","label":"初参加前に不安だったことを教えてください","type":"multiple","required":true,"showIf":{"question":"club_awareness","equals":"attended"},"options":[{"id":"exercise_not_confident","label":"運動が苦手・体力に自信がなかった","semanticCodes":{"primary":"physical_ability","secondary":[]}},{"id":"health_concern","label":"体調やケガの面が不安だった","semanticCodes":{"primary":"health_injury","secondary":[]}},{"id":"skill_anxiety","label":"経験者についていけるか不安だった","semanticCodes":{"primary":"skill_level","secondary":[]}},{"id":"rules_unknown","label":"野球やキャッチボールのルール・進め方が分からず不安だった","semanticCodes":{"primary":"rules_uncertainty","secondary":[]}},{"id":"solo","label":"一人参加が不安だった","semanticCodes":{"primary":"solo_participation","secondary":[]}},{"id":"regulars","label":"常連の輪に入れるか不安だった","semanticCodes":{"primary":"relationships","secondary":["atmosphere"]}},{"id":"participants_unknown","label":"どんな参加者が来るか分からず不安だった","semanticCodes":{"primary":"participant_info_uncertainty","secondary":[]}},{"id":"age_fit","label":"参加者の年齢層に自分が合うか不安だった","semanticCodes":{"primary":"age","secondary":[]}},{"id":"body_fit","label":"体型や見た目が場に合うか不安だった","semanticCodes":{"primary":"body_image","secondary":[]}},{"id":"sexual_atmosphere","label":"性的な雰囲気や望まない身体接触がないか不安だった","semanticCodes":{"primary":"sexual_atmosphere_contact","secondary":[]}},{"id":"hard_to_refuse","label":"嫌なことをはっきり断れるか不安だった","semanticCodes":{"primary":"boundary_safety","secondary":[]}},{"id":"photo_privacy","label":"写真を撮られること・SNS掲載・身バレが不安だった","semanticCodes":{"primary":"privacy_photo","secondary":["sexuality_identity"]}},{"id":"equipment","label":"ユニフォームやグローブなどの用具面が不安だった","semanticCodes":{"primary":"equipment","secondary":[]}},{"id":"weather","label":"暑さ・寒さ・雨など屋外環境が不安だった","semanticCodes":{"primary":"weather_environment","secondary":[]}},{"id":"other","label":"その他","other":true},{"id":"none","label":"特に不安はなかった","exclusive":true}],"maxLength":null,"otherMaxLength":150,"publication":{"visibility":"public","tier":"bias_sensitive","minTotal":30,"minTarget":20,"minCell":3,"sensitiveBranch":true,"ordinal":false,"sort":"count_desc","tieBreak":"schema_option_order","showZeroCells":false,"denominator":"question_reached"}},{"id":"attendance_lapse_reasons","section":"attendee","label":"最近参加していない理由として当てはまるものを教えてください","type":"multiple","required":true,"showIf":{"conditionRef":"lapsed_attendee"},"options":[{"id":"schedule","label":"開催日時が合わなくなった","semanticCodes":{"primary":"schedule","secondary":[]}},{"id":"location","label":"開催場所が行きにくい","semanticCodes":{"primary":"location","secondary":[]}},{"id":"work_life","label":"仕事・学業・私生活が忙しくなった","semanticCodes":{"primary":"work_life","secondary":[]}},{"id":"health_injury","label":"体調・ケガなど健康面の負担があった","semanticCodes":{"primary":"health_injury","secondary":[]}},{"id":"weather","label":"暑さ・寒さ・雨など屋外環境が負担になった","semanticCodes":{"primary":"weather_environment","secondary":[]}},{"id":"skill_level","label":"自分の経験・レベルと合わないと感じた","semanticCodes":{"primary":"skill_level","secondary":[]}},{"id":"content_fit","label":"活動内容やスポーツ・交流・撮影のバランスが自分に合わなかった","semanticCodes":{"primary":"content_fit","secondary":[]}},{"id":"relationships","label":"特定の参加者との人間関係が気になった","semanticCodes":{"primary":"relationships","secondary":[]}},{"id":"regulars","label":"常連の輪や場全体の雰囲気に入りにくかった","semanticCodes":{"primary":"relationships","secondary":["atmosphere"]}},{"id":"age","label":"参加者の年齢層が自分に合わないと感じた","semanticCodes":{"primary":"age","secondary":[]}},{"id":"body_image","label":"体型や見た目が気になった","semanticCodes":{"primary":"body_image","secondary":[]}},{"id":"community_scope","label":"ゲイ・男性同性愛者向けの場であることが自分に合わなかった","semanticCodes":{"primary":"community_scope_fit","secondary":[]}},{"id":"sexual_atmosphere","label":"性的な雰囲気や距離感が自分に合わなかった","semanticCodes":{"primary":"sexual_atmosphere_contact","secondary":[]}},{"id":"solo","label":"一人で参加し続けるのが負担になった","semanticCodes":{"primary":"solo_participation","secondary":[]}},{"id":"interest","label":"野球・ユニフォームへの興味が薄れた","semanticCodes":{"primary":"interest_change","secondary":[]}},{"id":"privacy_photo","label":"写真撮影やSNS掲載への不安・抵抗があった","semanticCodes":{"primary":"privacy_photo","secondary":["sexuality_identity"]}},{"id":"cost","label":"参加費・交通費などの費用が気になった","semanticCodes":{"primary":"cost","secondary":[]}},{"id":"motivation","label":"特に明確な理由はなく自然に足が遠のいた","semanticCodes":{"primary":"motivation","secondary":[]}},{"id":"other","label":"その他","other":true}],"maxLength":null,"otherMaxLength":150,"publication":{"visibility":"public","tier":"bias_sensitive","minTotal":30,"minTarget":20,"minCell":3,"sensitiveBranch":true,"ordinal":false,"sort":"count_desc","tieBreak":"schema_option_order","showZeroCells":false,"denominator":"question_reached"}},{"id":"rejoin_conditions","section":"attendee","label":"どんな変化があれば、また参加しやすくなりますか","type":"multiple","required":true,"showIf":{"conditionRef":"lapsed_attendee"},"options":[{"id":"more_dates","label":"開催日が増える"},{"id":"different_times","label":"開催曜日・時間帯が変わる"},{"id":"nearer_location","label":"開催場所が増える・近くなる"},{"id":"small_group","label":"少人数の回がある"},{"id":"returner_session","label":"初参加・久しぶりの人向けの回がある"},{"id":"beginner_session","label":"初心者中心の回がある"},{"id":"experienced_session","label":"経験者向けの回がある"},{"id":"more_catchball","label":"キャッチボール中心の回がある"},{"id":"more_games","label":"軽い試合・ゲームがある"},{"id":"more_photo","label":"写真撮影を楽しめる回がある"},{"id":"more_social","label":"交流・雑談を楽しめる回がある"},{"id":"participant_info","label":"参加者層や当日の雰囲気が事前に分かる"},{"id":"loaners","label":"道具・ユニフォームの貸出がある"},{"id":"no_change","label":"特に変更がなくても都合が合えばまた参加したい","exclusive":true},{"id":"other","label":"その他","other":true}],"maxLength":null,"otherMaxLength":150,"publication":{"visibility":"public","tier":"bias_sensitive","minTotal":30,"minTarget":20,"minCell":3,"sensitiveBranch":true,"ordinal":false,"sort":"count_desc","tieBreak":"schema_option_order","showZeroCells":false,"denominator":"question_reached"}},{"id":"preferred_program","section":"operations","label":"どのような内容なら参加しやすいですか","type":"multiple","required":true,"showIf":{"conditionRef":"operations_eligible"},"options":[{"id":"beginner_catchball","label":"初心者中心のキャッチボール"},{"id":"mixed_level","label":"経験者と初心者の混合"},{"id":"catchball_only","label":"キャッチボールのみ"},{"id":"light_fielding","label":"軽い守備練習"},{"id":"simple_game","label":"簡単なゲーム"},{"id":"uniform_photo","label":"ユニフォームでの写真撮影"},{"id":"social","label":"雑談・交流"},{"id":"none","label":"特にない・まだ分からない","exclusive":true}],"maxLength":null,"publication":{"visibility":"public","tier":"bias_sensitive","minTotal":30,"minTarget":10,"minCell":3,"sensitiveBranch":false,"ordinal":false,"sort":"count_desc","tieBreak":"schema_option_order","showZeroCells":false,"denominator":"question_reached"}},{"id":"preferred_schedule","section":"operations","label":"参加しやすい曜日・時間帯を選んでください","type":"multiple","required":true,"showIf":{"conditionRef":"operations_eligible"},"options":[{"id":"weekday_day","label":"平日昼"},{"id":"weekday_night","label":"平日夜"},{"id":"sat_morning","label":"土曜午前"},{"id":"sat_afternoon","label":"土曜午後"},{"id":"sat_evening","label":"土曜夕方"},{"id":"sun_morning","label":"日曜午前"},{"id":"sun_afternoon","label":"日曜午後"},{"id":"sun_evening","label":"日曜夕方"},{"id":"holiday","label":"祝日"},{"id":"no_preference","label":"特にこだわらない","exclusive":true}],"maxLength":null,"publication":{"visibility":"public","tier":"bias_sensitive","minTotal":30,"minTarget":10,"minCell":3,"sensitiveBranch":false,"ordinal":false,"sort":"count_desc","tieBreak":"schema_option_order","showZeroCells":false,"denominator":"question_reached"}},{"id":"preferred_size","section":"operations","label":"参加しやすい人数は何人程度ですか","type":"single","required":true,"showIf":{"conditionRef":"operations_eligible"},"options":[{"id":"three_five","label":"3〜5人"},{"id":"six_eight","label":"6〜8人"},{"id":"nine_twelve","label":"9〜12人"},{"id":"thirteen_plus","label":"13人以上"},{"id":"no_preference","label":"人数は気にしない"}],"maxLength":null,"publication":{"visibility":"public","tier":"bias_sensitive","minTotal":30,"minTarget":10,"minCell":3,"sensitiveBranch":false,"ordinal":true,"showZeroCells":true,"denominator":"question_reached"}},{"id":"age_limit_effect","section":"operations","label":"通常回とは別に「39歳以下限定」の回が設けられた場合、参加しやすさは変わりますか","type":"single","required":true,"showIf":{"conditionRef":"operations_eligible"},"options":[{"id":"much_easier","label":"参加しやすくなる"},{"id":"somewhat_easier","label":"どちらかといえば参加しやすくなる"},{"id":"no_change","label":"特に変わらない"},{"id":"somewhat_harder","label":"どちらかといえば参加しにくくなる"},{"id":"much_harder","label":"参加しにくくなる"},{"id":"ineligible","label":"自分は対象年齢外なので、その限定回には参加できない"},{"id":"unsure","label":"分からない"}],"maxLength":null,"scenarioId":"under_40_only","publication":{"visibility":"public","tier":"bias_sensitive","minTotal":30,"minTarget":10,"minCell":3,"sensitiveBranch":false,"ordinal":true,"showZeroCells":true,"denominator":"question_reached"}},{"id":"participation_fee_tolerance","section":"operations","label":"現在は無料ですが、将来参加費が必要になった場合、1回あたりの上限として最も近いものを選んでください","type":"single","required":true,"showIf":{"conditionRef":"operations_eligible"},"options":[{"id":"no_paid","label":"参加費が必要なら参加しない","maxYen":0},{"id":"up_to_500","label":"500円まで","maxYen":500},{"id":"up_to_1000","label":"1,000円まで","maxYen":1000},{"id":"up_to_2000","label":"2,000円まで","maxYen":2000},{"id":"up_to_3000","label":"3,000円まで","maxYen":3000},{"id":"over_3000","label":"3,000円を超えても内容によっては検討できる","minYen":3000}],"maxLength":null,"publication":{"visibility":"public","tier":"bias_sensitive","minTotal":30,"minTarget":10,"minCell":3,"sensitiveBranch":false,"ordinal":true,"showZeroCells":true,"denominator":"question_reached"}},{"id":"announcement_lead_time","section":"operations","label":"開催日のどのくらい前に告知があると参加しやすいですか","type":"single","required":true,"showIf":{"conditionRef":"operations_eligible"},"options":[{"id":"three_days","label":"3日前くらい"},{"id":"one_week","label":"1週間前くらい"},{"id":"two_weeks","label":"2週間前くらい"},{"id":"three_weeks","label":"3週間前くらい"},{"id":"one_month","label":"1か月前くらい"},{"id":"over_month","label":"1か月以上前"},{"id":"no_preference","label":"特に気にしない"}],"maxLength":null,"publication":{"visibility":"public","tier":"bias_sensitive","minTotal":30,"minTarget":10,"minCell":3,"sensitiveBranch":false,"ordinal":true,"showZeroCells":true,"denominator":"question_reached"}},{"id":"announcement_style","section":"operations","label":"開催予定の知らせ方として、あると参加しやすいものを選んでください","type":"multiple","required":true,"showIf":{"conditionRef":"operations_eligible"},"options":[{"id":"monthly_batch","label":"翌月分などをまとめて告知"},{"id":"each_event","label":"開催ごとに都度告知"},{"id":"fixed_schedule","label":"定例曜日・時間を固定して告知"},{"id":"no_preference","label":"特にこだわらない","exclusive":true}],"maxLength":null,"publication":{"visibility":"public","tier":"bias_sensitive","minTotal":30,"minTarget":10,"minCell":3,"sensitiveBranch":false,"ordinal":false,"sort":"count_desc","tieBreak":"schema_option_order","showZeroCells":false,"denominator":"question_reached"}},{"id":"announcement_channels","section":"operations","label":"開催情報を受け取りやすい方法を教えてください","type":"multiple","required":true,"showIf":{"conditionRef":"operations_eligible"},"options":[{"id":"x","label":"X"},{"id":"line_openchat","label":"LINEオープンチャット"},{"id":"website","label":"Webサイト"},{"id":"instagram","label":"Instagram"},{"id":"email","label":"メール"},{"id":"other","label":"その他","other":true},{"id":"no_preference","label":"特にこだわらない","exclusive":true}],"maxLength":null,"otherMaxLength":80,"publication":{"visibility":"public","tier":"bias_sensitive","minTotal":30,"minTarget":10,"minCell":3,"sensitiveBranch":false,"ordinal":false,"sort":"count_desc","tieBreak":"schema_option_order","showZeroCells":false,"denominator":"question_reached"}},{"id":"student_activities","section":"activity_history","label":"学生時代（中学〜大学年代）に経験した部活・クラブ・サークルを教えてください","type":"multiple","adminTallySort":"count_desc","required":true,"options":[{"id":"baseball_softball","label":"野球・ソフトボール","sportCode":"baseball"},{"id":"soccer_futsal","label":"サッカー・フットサル","sportCode":"soccer"},{"id":"basketball","label":"バスケットボール","sportCode":"basketball"},{"id":"volleyball","label":"バレーボール","sportCode":"volleyball"},{"id":"rugby_american_football","label":"ラグビー・アメリカンフットボール","sportCode":"rugby_football"},{"id":"track_field","label":"陸上競技","sportCode":"track_field"},{"id":"swimming","label":"水泳","sportCode":"swimming"},{"id":"tennis","label":"テニス","sportCode":"tennis"},{"id":"table_tennis_badminton","label":"卓球・バドミントン","sportCode":"racket_indoor"},{"id":"gymnastics","label":"体操競技","sportCode":"gymnastics"},{"id":"martial_arts","label":"柔道・剣道などの武道","sportCode":"martial_arts"},{"id":"wrestling_combat","label":"レスリング・格闘技","sportCode":"wrestling_combat"},{"id":"cycling","label":"自転車・サイクリング","sportCode":"cycling"},{"id":"other_sport","label":"その他の運動系","sportCode":"other_sport"},{"id":"culture","label":"文化系の部活・クラブ","activityCode":"culture"},{"id":"other","label":"その他","other":true},{"id":"none","label":"特に活動経験はない","exclusive":true}],"maxLength":null,"otherMaxLength":100,"analysisUse":"競技・活動経験の幅を把握し、スポーツユニフォーム嗜好・成人後の活動との補助比較に使う","publication":{"visibility":"private"},"showIf":{"conditionRef":"activity_history_eligible"}},{"id":"activity_stopped","section":"activity_history","label":"学生時代までにしていた活動で、途中でやめた・自然に離れたものはありますか","type":"single","required":true,"options":[{"id":"yes","label":"ある"},{"id":"no","label":"ない"},{"id":"dont_remember","label":"覚えていない・回答しない"}],"maxLength":null,"analysisUse":"活動継続を妨げる一般要因を現在の参加障壁と比較するため","publication":{"visibility":"private"},"showIf":{"conditionRef":"activity_history_eligible"}},{"id":"activity_stopped_reasons","section":"activity_history","label":"途中でやめた、または続けなくなった理由を教えてください","type":"multiple","adminTallySort":"count_desc","required":true,"showIf":{"all":[{"conditionRef":"activity_history_eligible"},{"question":"activity_stopped","equals":"yes"}]},"options":[{"id":"environment_ended","label":"進学・卒業などで従来の活動環境がなくなった","semanticCodes":{"primary":"life_transition","secondary":[]}},{"id":"work_life","label":"仕事・学業・私生活が忙しくなった","semanticCodes":{"primary":"work_life","secondary":[]}},{"id":"move","label":"引っ越し・転居などで通いにくくなった","semanticCodes":{"primary":"location","secondary":[]}},{"id":"cost","label":"費用が負担になった","semanticCodes":{"primary":"cost","secondary":[]}},{"id":"physical","label":"ケガ・体調・体力面の理由","semanticCodes":{"primary":"health_injury","secondary":["physical_ability"]}},{"id":"skill","label":"上達できない・自分に合わないと感じた","semanticCodes":{"primary":"skill_level","secondary":[]}},{"id":"interest","label":"興味が別のものに移った","semanticCodes":{"primary":"interest_change","secondary":[]}},{"id":"relationships","label":"人間関係が合わなかった","semanticCodes":{"primary":"relationships","secondary":[]}},{"id":"atmosphere","label":"上下関係・競争・体育会系など場の雰囲気が合わなかった","semanticCodes":{"primary":"atmosphere","secondary":[]}},{"id":"no_companions","label":"一緒にやる人がいなくなった","semanticCodes":{"primary":"solo_participation","secondary":["relationships"]}},{"id":"sexuality","label":"性的指向に関わることで居づらさを感じた","semanticCodes":{"primary":"sexuality_identity","secondary":[]}},{"id":"motivation","label":"特に明確な理由はなく自然に行かなくなった","semanticCodes":{"primary":"motivation","secondary":[]}},{"id":"other","label":"その他","other":true}],"maxLength":null,"otherMaxLength":150,"analysisUse":"スポーツ・活動を続けられなくなる一般要因を、現在の参加障壁・離脱理由とsemantic codeで比較するため","publication":{"visibility":"private"}},{"id":"adult_sports","section":"adult_activity","label":"社会人になってから経験したスポーツ・運動をすべて選んでください","type":"multiple","adminTallySort":"count_desc","required":true,"options":[{"id":"baseball_softball","label":"野球・ソフトボール","sportCode":"baseball"},{"id":"catchball","label":"キャッチボール","sportCode":"baseball"},{"id":"soccer_futsal","label":"サッカー・フットサル","sportCode":"soccer"},{"id":"basketball","label":"バスケットボール","sportCode":"basketball"},{"id":"volleyball","label":"バレーボール","sportCode":"volleyball"},{"id":"rugby_football","label":"ラグビー・アメリカンフットボール","sportCode":"rugby_football"},{"id":"track_running","label":"陸上・ランニング・ジョギング","sportCode":"track_running"},{"id":"swimming","label":"水泳","sportCode":"swimming"},{"id":"tennis","label":"テニス","sportCode":"tennis"},{"id":"table_badminton","label":"卓球・バドミントン","sportCode":"racket_indoor"},{"id":"martial_combat","label":"武道・格闘技","sportCode":"martial_arts"},{"id":"cycling","label":"自転車・サイクリング","sportCode":"cycling"},{"id":"gym","label":"ジム・筋力トレーニング","sportCode":"gym"},{"id":"walking_hiking","label":"ウォーキング・登山・ハイキング","sportCode":"walking_hiking"},{"id":"dance_fitness","label":"ダンス・フィットネス","sportCode":"dance_fitness"},{"id":"other","label":"その他","other":true},{"id":"none","label":"社会人になってからスポーツ・運動経験はない","exclusive":true}],"maxLength":null,"otherMaxLength":100,"publication":{"visibility":"private"},"showIf":{"conditionRef":"activity_history_eligible"}},{"id":"adult_context","section":"adult_activity","label":"社会人になってからのスポーツ・運動は、どのような環境で行いましたか","type":"multiple","adminTallySort":"count_desc","required":true,"showIf":{"all":[{"conditionRef":"activity_history_eligible"},{"question":"adult_sports","hasAnyExcept":["none"]}]},"options":[{"id":"gay_men_group","label":"ゲイ・男性同性愛者向けのサークル・集まり"},{"id":"general_group","label":"性的指向を限定しない一般のサークル・社会人チーム"},{"id":"work_team","label":"職場・会社のチーム"},{"id":"gym_club","label":"民間スポーツクラブ・ジム"},{"id":"friends","label":"友人・知人との集まり"},{"id":"individual","label":"個人での活動"},{"id":"other","label":"その他","other":true}],"maxLength":null,"otherMaxLength":100,"analysisUse":"成人後に一般サークル・ゲイ向けサークル・個人活動等の経験があるかを、参加障壁・安心条件のAdmin内部分析に限定して用いる。公開しない","publication":{"visibility":"private"}},{"id":"exercise_frequency","section":"adult_activity","label":"現在の運動頻度を教えてください","type":"single","required":true,"options":[{"id":"three_plus_week","label":"週3回以上"},{"id":"one_two_week","label":"週1〜2回"},{"id":"one_three_month","label":"月1〜3回"},{"id":"less_monthly","label":"月1回未満"},{"id":"none","label":"現在は運動していない"}],"maxLength":null,"publication":{"visibility":"public","tier":"early_factual","minTotal":10,"minTarget":10,"minCell":3,"sensitiveBranch":false,"ordinal":true,"showZeroCells":true,"denominator":"question_reached"}},{"id":"exercise_continuation_motivation","section":"adult_activity","label":"運動を続けられている理由・モチベーションは何ですか","helpText":"実際に続ける力になっているものを、当てはまるだけ選んでください。","type":"multiple","required":true,"showIf":{"question":"exercise_frequency","in":["three_plus_week","one_two_week","one_three_month","less_monthly"]},"options":[{"id":"health","label":"健康維持・体力を落としたくない"},{"id":"appearance","label":"体型・見た目を維持・改善したい"},{"id":"self_confidence","label":"自分に自信を持ちたい"},{"id":"stress_relief","label":"ストレス解消・気分転換になる"},{"id":"enjoyment","label":"運動そのものが楽しい"},{"id":"improvement","label":"上達・できることが増えるのが楽しい"},{"id":"goals","label":"記録・目標を達成したい"},{"id":"competition_event","label":"大会・試合・イベントに出たい"},{"id":"routine","label":"生活習慣・ルーティンになっている"},{"id":"friends","label":"仲間・友人と一緒に続けられる"},{"id":"community","label":"定期的に参加できる居場所・コミュニティがある"},{"id":"uniform","label":"ユニフォーム・スポーツウェアを着る楽しみがある"},{"id":"recognition","label":"人に見られる・褒められる・評価されるとうれしい"},{"id":"attractiveness","label":"モテたい・魅力的に見られたい"},{"id":"dating","label":"恋愛・出会いのきっかけにもしたい"},{"id":"sexual_appeal","label":"体つきや性的な魅力を高めたい"},{"id":"other","label":"その他","other":true},{"id":"no_conscious_reason","label":"特に意識していない・なんとなく続いている","exclusive":true}],"otherMaxLength":100,"analysisUse":"現在運動している回答者の実際の継続要因を把握する。exercise_motivationとは分け、こちらは現状の継続理由を測る。","publication":{"visibility":"public","tier":"bias_sensitive","minTotal":30,"minTarget":10,"minCell":3,"sensitiveBranch":false,"ordinal":false,"sort":"count_desc","tieBreak":"schema_option_order","showZeroCells":false,"denominator":"question_reached"}},{"id":"exercise_motivation","section":"adult_activity","label":"今後、運動を続ける・始める・再開するモチベーションになりそうなものは何ですか","type":"multiple","required":true,"options":[{"id":"health","label":"健康維持・体力向上"},{"id":"appearance","label":"体型・見た目の維持・改善"},{"id":"stress_relief","label":"ストレス解消・気分転換"},{"id":"enjoyment","label":"運動そのものの楽しさ"},{"id":"improvement","label":"上達・できることが増える実感"},{"id":"goals","label":"記録や目標を達成すること"},{"id":"competition_event","label":"大会・イベント・試合に参加すること"},{"id":"friends","label":"仲間・友人と一緒に楽しむこと"},{"id":"community","label":"定期的に参加できるコミュニティがあること"},{"id":"meet_people","label":"新しい人と知り合えること"},{"id":"uniform","label":"ユニフォーム・スポーツウェアを着る楽しみ"},{"id":"photo_record","label":"写真や記録を残す楽しみ"},{"id":"routine","label":"生活習慣・ルーティンとして続けること"},{"id":"recognition","label":"周囲から応援・評価されること"},{"id":"other","label":"その他","other":true},{"id":"none","label":"特にない","exclusive":true}],"maxLength":null,"otherMaxLength":100,"publication":{"visibility":"public","tier":"bias_sensitive","minTotal":30,"minTarget":10,"minCell":3,"sensitiveBranch":false,"ordinal":false,"sort":"count_desc","tieBreak":"schema_option_order","showZeroCells":false,"denominator":"question_reached"},"analysisUse":"全回答者を対象に、今後の継続・開始・再開のきっかけになり得る要因を把握する。exercise_continuation_motivationは現在運動している人の実際の継続要因、本設問は将来要因。"},{"id":"age","section":"profile","label":"年代を教えてください","type":"single","required":true,"options":[{"id":"18_24","label":"18〜24歳"},{"id":"25_29","label":"25〜29歳"},{"id":"30_39","label":"30〜39歳"},{"id":"40_49","label":"40〜49歳"},{"id":"50_59","label":"50〜59歳"},{"id":"60_plus","label":"60歳以上"},{"id":"prefer_not_to_say","label":"回答しない"}],"maxLength":null,"publication":{"visibility":"private"}},{"id":"prefecture","section":"profile","label":"お住まいの都道府県を教えてください","type":"single","adminTallySort":"count_desc","required":true,"options":[{"id":"pref_01","label":"北海道"},{"id":"pref_02","label":"青森県"},{"id":"pref_03","label":"岩手県"},{"id":"pref_04","label":"宮城県"},{"id":"pref_05","label":"秋田県"},{"id":"pref_06","label":"山形県"},{"id":"pref_07","label":"福島県"},{"id":"pref_08","label":"茨城県"},{"id":"pref_09","label":"栃木県"},{"id":"pref_10","label":"群馬県"},{"id":"pref_11","label":"埼玉県"},{"id":"pref_12","label":"千葉県"},{"id":"pref_13","label":"東京都"},{"id":"pref_14","label":"神奈川県"},{"id":"pref_15","label":"新潟県"},{"id":"pref_16","label":"富山県"},{"id":"pref_17","label":"石川県"},{"id":"pref_18","label":"福井県"},{"id":"pref_19","label":"山梨県"},{"id":"pref_20","label":"長野県"},{"id":"pref_21","label":"岐阜県"},{"id":"pref_22","label":"静岡県"},{"id":"pref_23","label":"愛知県"},{"id":"pref_24","label":"三重県"},{"id":"pref_25","label":"滋賀県"},{"id":"pref_26","label":"京都府"},{"id":"pref_27","label":"大阪府"},{"id":"pref_28","label":"兵庫県"},{"id":"pref_29","label":"奈良県"},{"id":"pref_30","label":"和歌山県"},{"id":"pref_31","label":"鳥取県"},{"id":"pref_32","label":"島根県"},{"id":"pref_33","label":"岡山県"},{"id":"pref_34","label":"広島県"},{"id":"pref_35","label":"山口県"},{"id":"pref_36","label":"徳島県"},{"id":"pref_37","label":"香川県"},{"id":"pref_38","label":"愛媛県"},{"id":"pref_39","label":"高知県"},{"id":"pref_40","label":"福岡県"},{"id":"pref_41","label":"佐賀県"},{"id":"pref_42","label":"長崎県"},{"id":"pref_43","label":"熊本県"},{"id":"pref_44","label":"大分県"},{"id":"pref_45","label":"宮崎県"},{"id":"pref_46","label":"鹿児島県"},{"id":"pref_47","label":"沖縄県"},{"id":"overseas","label":"海外"},{"id":"prefer_not_to_say","label":"回答しない"}],"maxLength":null,"publication":{"visibility":"private"}},{"id":"aichi_area","section":"profile","label":"お住まいの地域を教えてください","type":"single","required":true,"showIf":{"question":"prefecture","equals":"pref_23"},"options":[{"id":"nagoya","label":"名古屋市"},{"id":"owari","label":"尾張地方（名古屋市以外）"},{"id":"mikawa","label":"三河地方"},{"id":"prefer_not_to_say","label":"回答しない"}],"maxLength":null,"publication":{"visibility":"private"}},{"id":"residence_country","section":"profile","label":"お住まいの国・地域を教えてください","type":"text","required":true,"showIf":{"question":"prefecture","equals":"overseas"},"maxLength":60,"inputStyle":"single_line","publication":{"visibility":"private"},"helpText":"国名または地域名を1行で入力してください（例：アメリカ、台湾）。公開結果には表示されません。"},{"id":"feedback","section":"closing","label":"名古屋野球ユニ部への期待・改善してほしいことがあれば教えてください","type":"text","required":false,"maxLength":500,"publication":{"visibility":"private"}},{"id":"support_message","section":"closing","label":"名古屋野球ユニ部の運営への応援・激励メッセージがあればお願いします","type":"text","required":false,"maxLength":500,"publication":{"visibility":"private"},"helpText":"任意です。運営メンバーへの応援や励まし、今後も続けてほしいことなどがあれば自由にお書きください。"}],"adminFreeTextAttribution":{"prefecture":"prefecture","country":"residence_country","age":"age","overseasOptionId":"overseas","noAnswerOptionIds":["prefer_not_to_say"],"domesticLabel":"日本"},"uniformAppealGroups":{"visual":["design_color","silhouette"],"material_fit":["material_touch","smooth_texture","stretch_fit","thin_sheer","thick_solid","sweat_feel","undershirt","pants_fit_tension"],"identity_atmosphere":["team_identity","athletic_atmosphere","nostalgia","athlete_admiration"],"note":"公開時は各選択肢の単純集計を正本とし、グループ集計は同一回答者の重複を除いたユニーク回答者数で算出する"},"languagePolicy":{"photoWording":{"positive":"撮ってもらう／撮ってもらいたい","negative_or_anxiety":"撮られる","rule":"肯定的な希望・関心では『撮ってもらう』を用い、否定的・不安・受動性を表す文脈のみ『撮られる』を用いる"}},"publicRegionAggregation":{"enabled":true,"sourceQuestion":"prefecture","sourceOptionIdField":"id","publicLabel":"回答者の地域","denominator":"respondents_with_known_prefecture_or_overseas","excludeOptionIds":["prefer_not_to_say"],"blocks":[{"id":"hokkaido","label":"北海道","prefectureOptionIds":["pref_01"]},{"id":"tohoku","label":"東北","prefectureOptionIds":["pref_02","pref_03","pref_04","pref_05","pref_06","pref_07"]},{"id":"kanto","label":"関東","prefectureOptionIds":["pref_08","pref_09","pref_10","pref_11","pref_12","pref_13","pref_14"]},{"id":"koshinetsu_hokuriku","label":"甲信越・北陸","prefectureOptionIds":["pref_15","pref_16","pref_17","pref_18","pref_19","pref_20"]},{"id":"tokai","label":"東海","prefectureOptionIds":["pref_21","pref_22","pref_23","pref_24"]},{"id":"kansai","label":"関西","prefectureOptionIds":["pref_25","pref_26","pref_27","pref_28","pref_29","pref_30"]},{"id":"chugoku","label":"中国","prefectureOptionIds":["pref_31","pref_32","pref_33","pref_34","pref_35"]},{"id":"shikoku","label":"四国","prefectureOptionIds":["pref_36","pref_37","pref_38","pref_39"]},{"id":"kyushu_okinawa","label":"九州・沖縄","prefectureOptionIds":["pref_40","pref_41","pref_42","pref_43","pref_44","pref_45","pref_46","pref_47"]},{"id":"overseas","label":"海外","prefectureOptionIds":["overseas"]}],"publication":{"visibility":"public_derived","tier":"early_factual","minTotal":10,"minTarget":10,"minCell":3,"sensitiveBranch":false,"ordinal":false,"sort":"count_desc","tieBreak":"block_order","showZeroCells":false},"privacy":{"publishPrefectureDetail":false,"publishAichiAreaDetail":false,"smallCellStrategy":"merge_into_other_regions","mergedLabel":"その他の地域","complementarySuppression":true,"rule":"少数ブロックを『その他の地域』へまとめ、総数から単一セルを逆算できる状態を作らない"}},"publicResultsOrder":["region_blocks","baseball_experience","top_uniform_sport_experience","club_awareness","exercise_frequency","exercise_continuation_motivation","favorite_uniforms","top_uniform","uniform_appeal","uniform_engagement","baseball_play_interest","catchball_interest","uniform_social_interest","near_term_participation_intent","barriers","main_barrier","participation_conditions","preferred_program","preferred_schedule","preferred_size","age_limit_effect","participation_fee_tolerance","announcement_lead_time","announcement_style","announcement_channels","exercise_motivation","overall_satisfaction","satisfaction_atmosphere","satisfaction_beginner_support","satisfaction_activity","pre_attendance_worries","attendance_lapse_reasons","repeat_intent","rejoin_conditions"],"testModes":{"default":"production","modes":{"production":{"label":"本番","description":"通常の回答受付。保存され、本集計・公開集計の対象になる。","submitBehavior":"save","countInValidResponses":true,"includeInAdminProductionAnalysis":true,"includeInPublicResults":true},"preview_no_submit":{"label":"プレビュー（送信しない）","description":"フォーム表示・分岐・入力チェック・完了直前までを確認する。送信操作をしても回答は保存しない。","submitBehavior":"simulate_success_without_save","countInValidResponses":false,"includeInAdminProductionAnalysis":false,"includeInPublicResults":false,"allowDuplicateTesting":true,"notes":["Spreadsheetへ書き込まない","respondent_hashを本番重複判定へ登録しない","通知メールを送らない","本番GA4 propertyへ送信しない","public snapshot / cacheを変更しない"]},"closed_view":{"label":"終了後表示確認","description":"アンケート受付終了後の画面・文言・結果導線だけを再現する。回答入力・送信は行わない。","submitBehavior":"disabled","forcedSurveyStatus":"closed","countInValidResponses":false,"includeInAdminProductionAnalysis":false,"includeInPublicResults":false,"notes":["本番の受付状態や締切日時は変更しない","server statusを上書きせず、test context内だけclosed表示を再現する","本番submit endpointへ到達させない"]},"submit_excluded":{"label":"テスト送信（集計除外）","description":"本番と同じvalidation・hash・LockService・Spreadsheet保存経路を通してテスト送信するが、本集計・公開結果から完全に除外する。","submitBehavior":"save_as_test","countInValidResponses":false,"includeInAdminProductionAnalysis":false,"includeInPublicResults":false,"responseMarker":{"field":"response_mode","value":"test"},"notes":["本番と同じserver validation・LockService・保存経路を通す","response_mode=testで保存する","本番valid count・Admin本番分析・public snapshot・finalizeから除外する","test hash namespaceをproductionと分離する","本番GA4 propertyへは送信しない","通知は原則抑止し、通知テスト時はTESTを明示する"]}},"activation":{"policy":"テストモードは一般回答者がURLを書き換えるだけで有効化できないこと。","clientOnlyModes":["preview_no_submit","closed_view"],"serverVerifiedModes":["submit_excluded"],"clientOnlyNote":"preview_no_submit / closed_view は回答をserverへsubmitしないclient-only previewのため、submit用test token検証は不要。","requirements":["submit_excludedのみserverへ送信し、server-sideでtest tokenを検証してtest modeを確定する","公開URLのquery parameterだけを信頼しない","管理者専用のsecret / deployment / authenticated admin launcher等の安全な経路からのみ有効化する","production以外のmodeは画面上に明確なTEST表示を常時出す"]},"persistence":{"responseModeField":"response_mode","allowedValues":["production","test"],"testRunIdField":"test_run_id","testRunIdRequiredForTest":true,"testRunIdPurpose":"複数のテスト実行を識別し、後から一括確認・削除せずとも分析対象外として追跡できるようにする"},"aggregationSafety":{"productionPopulationFilter":"response_mode == 'production'","testPopulationFilter":"response_mode == 'test'","finalizeRule":"response_mode == 'production' のみresponses_validおよびfinal public snapshotへ含める","failClosed":"response_modeが欠損・未知値の場合は本番集計へ含めない"}},"persistenceSchema":{"systemFields":["timestamp","survey_version","schema_version","design_version","response_mode","test_run_id","respondent_hash","completion_status","source_channel","client_elapsed_ms","notification_status"],"sourceChannel":{"visibility":"private","allowlist":["x","line","website","instagram","email","direct","unknown"],"unknownFallback":"unknown","prohibitPersonalCodes":true,"note":"個人ごとのDM・ユーザー名等をsource codeにしない"}},"testModeAcceptanceCriteria":[{"mode":"preview_no_submit","checks":["全分岐を操作できる","required / other / exclusive validationを確認できる","送信操作後もSpreadsheet行数が増えない","本番重複判定に影響しない"]},{"mode":"closed_view","checks":["終了後画面が表示される","入力フォームが送信不能である","本番survey statusは変更されない"]},{"mode":"submit_excluded","checks":["本番と同じserver validationを通る","Spreadsheetへresponse_mode=testで保存される","本番totalが増えない","公開結果が変化しない","finalize対象件数が増えない","Admin本番集計へ出ない","テスト専用確認では見える"]}],"conditions":{"attendee":{"question":"club_awareness","equals":"attended"},"nonattendee":{"question":"club_awareness","in":["aware_not_attended","name_only","first_time"]},"nonattendee_interested":{"all":[{"question":"club_awareness","in":["aware_not_attended","name_only","first_time"]},{"question":"catchball_interest","in":["very_interested","if_conditions","some_interest"]}]},"lapsed_attendee":{"all":[{"question":"club_awareness","equals":"attended"},{"question":"last_attended","in":["three_to_six_m","six_to_twelve_m","over_1y","dont_remember"]}]},"operations_eligible":{"any":[{"question":"club_awareness","equals":"attended"},{"all":[{"question":"club_awareness","in":["aware_not_attended","name_only","first_time"]},{"question":"catchball_interest","in":["very_interested","if_conditions","some_interest"]}]}]},"activity_history_eligible":{"any":[{"question":"club_awareness","equals":"attended"},{"all":[{"question":"club_awareness","in":["aware_not_attended","name_only","first_time"]},{"question":"catchball_interest","in":["very_interested","if_conditions","some_interest"]}]}]}},"respondentNotice":{"purpose":"名古屋野球ユニ部の今後の運営・企画改善","eligibility":"18歳以上","estimatedMinutes":{"min":5,"max":12},"adminAccess":"個別回答の管理画面は運営責任者1名のみ閲覧","analytics":"GA4等を利用するが、回答内容・設問ID・分岐内容・自由記述は送信しない","postSubmitEditDelete":"匿名性を優先するため、送信後に特定回答を本人確認して修正・削除することは原則できない","partialResponse":"最後にまとめて送信する方式とし、途中離脱時は回答本文をサーバーへ保存しない","externalAI":"生の個別回答・自由記述は外部AIへ渡さず、必要な場合は集計済みまたは個人を特定しにくい形へ加工したデータのみ利用する","representativeness":"SNS・Web等を通じて回答を募るため、一般人口全体を代表する統計ではない","retention":{"status":"confirmed","readinessRule":"保持期限と削除方針が未設定なら本番公開不可"}},"semanticCodePolicy":{"format":{"primary":"one code","secondary":"zero or more codes"},"assignment":"自由記述を後から主観分類するのではなく、schema作成時に各optionへ付与する","aggregation":"codeごとに回答者単位で重複なく数える"},"publicationPolicy":{"sourceOfTruth":"各設問の publication オブジェクト。設問ID別のtier/output重複リストは持たない","ui":{"sections":[{"id":"response_status","label":"現在の回答状況","selector":{"tier":"live_count_or_early_factual"}},{"id":"survey_results","label":"アンケート結果","selector":{"tier":"bias_sensitive_or_final"}}],"representativenessNotice":"この調査はSNS・Web等を通じて回答を募ったもので、一般人口全体を代表する統計ではありません。"},"liveCount":{"under10":"回答受付中","roundingAfter10":"floor_to_10","examples":["10件以上","20件以上","30件以上"]},"snapshotUpdate":{"mode":"batch_only","preferred":"daily","countTriggerIncrement":10,"minimumBatchIncrement":3,"perResponseUpdate":false,"cacheInvalidation":"public snapshotを更新した時だけcacheを切り替える"},"cellPrivacy":{"defaultMinCell":3,"complementarySuppression":true,"rule":"small cellが1つだけ残る場合は、別セルも抑制するか『その他・少数』へ統合して逆算を防ぐ"},"ordering":{"ordinal":"schema_order","nominal":"count_desc","validation":"publication.ordinal=true の設問に publication.sort があればschema error"},"neverPublish":["個別回答","自由記述本文","詳細都道府県","愛知県内地域","respondent_hash","UUID","個別timestamp","詳細クロス集計","source_channel"]},"sectionUx":{"showProgress":true,"progressBasis":"visible_route_questions","progressDisplay":{"showSectionCount":true,"showPercent":true,"showEstimatedRemainingTime":true,"remainingTimeMethod":"estimate_from_visible_route_and_completed_questions","copyExamples":["現在 3/8 セクション","全体の約40%","残り約4分"]},"privacy":{"sendProgressToGA4":false,"sendSectionNamesToGA4":false,"note":"進捗・section・routeはsurvey UI内だけで使用し、GA4には送らない"},"milestones":[{"afterQuestion":"top_uniform_sport_experience","fallbackAfterQuestion":"baseball_experience","message":"ここまでがユニフォームについての質問です。ここから先は、キャッチボール会への関心や参加経験に応じて必要な質問だけ表示します。"},{"beforeQuestion":"preferred_program","conditionRef":"operations_eligible","message":"ここからは、実際に参加を検討している方向けの質問です。"}],"lowInterestAcknowledgement":{"trigger":{"question":"catchball_interest","in":["low_interest","not_interested"]},"message":"ありがとうございます。今のところ参加への関心が薄いという回答も、今後の企画を考えるうえで大切な回答です。"},"introEstimate":"興味のある内容や回答ルートによって、5〜12分程度です。"},"routeUx":{"pure_uniform_short_route":{"trigger":{"all":[{"question":"club_awareness","in":["aware_not_attended","name_only","first_time"]},{"question":"catchball_interest","in":["low_interest","not_interested"]}]},"flow":["uniform_social_interest","exercise_frequency","exercise_motivation","age","prefecture","aichi_area","residence_country","feedback","support_message"],"messageBeforeProfile":"キャッチボール会についての詳しい運営質問はここで終了です。現在の運動頻度と運動・再開のモチベーションは全員共通で伺い、その後に基本項目へ進みます。"}},"terminologyPolicy":{"clubName":"名古屋野球ユニ部","eventName":"キャッチボール会","uniformOnlyActivity":"ユニフォーム交流","rule":"団体全体は『名古屋野球ユニ部』、運動イベントは『キャッチボール会』、着る・見る・撮る中心の企画は『ユニフォーム交流』と使い分ける"}};

/*
 * 名古屋野球ユニ部アンケート（design v2.17）：schema駆動の共通エンジン（専用fork）。
 *
 * community/gas/costume_portrait_survey/src/survey-core.js を出発点に独立させたもの。
 * 衣装・ポトレ調査の運用中coreには一切手を入れない（共通化は本surveyが安定してから別Issueで検討する）。
 *
 * 設計方針
 *  - 副作用なし。schema / answers を書き換えず、時刻・乱数・storage・network に触れない。
 *  - Frontend / Public GAS / Admin が同じ関数を同じ意味で使う（#380 / #381 が再利用する前提）。
 *  - 設問・選択肢・分岐・公開設定をここにベタ書きしない（すべて schema を参照する）。
 *  - 不正・未知の条件は fail-safe（false = 表示しない / 到達していない）に倒す。
 *  - 本ファイルは hash 生成・最短回答時間検証・test token 検証・保存処理を持たない（#380 の責務）。
 *    旧surveyの test 状態値や無区切りの hash 連結式、旧validation定数も持ち込まない。
 *
 * ES5記法。ブラウザ・Apps Script V8・Node.js のいずれでも動く。
 * Node.js では module.exports でも公開する（tests用）。
 */
var SurveyCore = (function () {
  'use strict';

  var CONTROL_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/;
  var MAX_CONDITION_DEPTH = 32;
  var SINGLE_VALUE_TYPES = { single: true, single_dynamic: true, scale: true };
  var KNOWN_TYPES = { single: true, multiple: true, single_dynamic: true, scale: true, text: true };
  var LEAF_OPERATORS = ['equals', 'notEquals', 'in', 'contains', 'notContains', 'hasAnyExcept'];
  var GROUP_OPERATORS = ['all', 'any'];

  function hasOwn(obj, key) { return Object.prototype.hasOwnProperty.call(obj, key); }
  function isPlainObject(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
  }
  function isNonEmptyString(value) { return typeof value === 'string' && value !== ''; }
  function contains(list, item) { return list.indexOf(item) !== -1; }
  function charLength(text) { return Array.from(String(text)).length; }
  function normalizeText(text) { return String(text).replace(/\r\n?/g, '\n').trim(); }

  /* ── schema 参照 ── */

  function getQuestions(schema) {
    return isPlainObject(schema) && Array.isArray(schema.questions) ? schema.questions : [];
  }

  function getQuestion(schema, id) {
    if (typeof id !== 'string') return null;
    var list = getQuestions(schema);
    for (var i = 0; i < list.length; i++) {
      if (list[i] && list[i].id === id) return list[i];
    }
    return null;
  }

  function questionIds(schema) {
    return getQuestions(schema).map(function (q) { return q.id; });
  }

  /* schema に直接書かれた選択肢（single / multiple）。single_dynamic は getDynamicOptions を使う。 */
  function getOptions(schema, question) {
    return question && Array.isArray(question.options) ? question.options : [];
  }

  function isKnownType(type) { return hasOwn(KNOWN_TYPES, type); }

  /* ── 回答値の正規化 ── */

  /*
   * 選択済みIDの配列。single / single_dynamic / scale は 0 or 1 件、multiple は複数。
   * scale は数値でも文字列でも受け取り、schema のscale ID（"1".."5" / notApplicable.id）の文字列に揃える。
   * 型が合わない値は未回答（空）として扱う。
   */
  function selectedIds(question, value) {
    if (!question) return [];
    if (question.type === 'multiple') {
      return Array.isArray(value)
        ? value.filter(function (v) { return typeof v === 'string' && v !== ''; })
        : [];
    }
    if (question.type === 'scale') {
      if (typeof value === 'number' && isFinite(value)) return [String(value)];
      return isNonEmptyString(value) ? [value] : [];
    }
    if (question.type === 'single' || question.type === 'single_dynamic') {
      return isNonEmptyString(value) ? [value] : [];
    }
    return [];
  }

  function isEmptyValue(question, value) {
    if (value === undefined || value === null) return true;
    if (question.type === 'text') return typeof value === 'string' && normalizeText(value) === '';
    if (question.type === 'multiple') return Array.isArray(value) && value.length === 0;
    if (typeof value === 'string') return value === '';
    return false;
  }

  /* ── 可視性の評価コンテキスト ── */

  /*
   * 可視性は「親が非表示なら、その回答値は無かったものとして扱う」規則で決める。
   * 設問Xの値を条件が参照するとき、Xが非表示なら値は未回答として見える。
   * これにより、親条件がfalseになった後にstateへ旧値が残っていても子の表示判定へ漏れない。
   * 循環参照は fail-safe（false）。
   */
  function createContext(schema, answers) {
    var byId = {};
    var order = [];
    getQuestions(schema).forEach(function (q) {
      if (q && typeof q.id === 'string' && !hasOwn(byId, q.id)) {
        byId[q.id] = q;
        order.push(q.id);
      }
    });
    return {
      schema: schema,
      answers: isPlainObject(answers) ? answers : {},
      byId: byId,
      order: order,
      visibleMemo: {},
      visiting: {}
    };
  }

  function questionOf(ctx, id) {
    return typeof id === 'string' && hasOwn(ctx.byId, id) ? ctx.byId[id] : null;
  }

  function visibleIn(ctx, id) {
    var question = questionOf(ctx, id);
    if (!question) return false;
    if (hasOwn(ctx.visibleMemo, id)) return ctx.visibleMemo[id];
    if (ctx.visiting[id]) return false;
    ctx.visiting[id] = true;
    var result = !question.showIf || evalNode(ctx, question.showIf, [], 0);
    delete ctx.visiting[id];
    ctx.visibleMemo[id] = result;
    return result;
  }

  /* 条件から見える回答値。非表示の設問は未回答扱い。 */
  function effectiveSelected(ctx, id) {
    var question = questionOf(ctx, id);
    if (!question || !visibleIn(ctx, id)) return null;
    return selectedIds(question, ctx.answers[id]);
  }

  function leafOperator(node) {
    var found = LEAF_OPERATORS.filter(function (op) { return hasOwn(node, op); });
    return found.length === 1 ? found[0] : null;
  }

  function evalLeaf(ctx, node) {
    var op = leafOperator(node);
    if (!op) return false;
    var question = questionOf(ctx, node.question);
    if (!question || !isKnownType(question.type) || question.type === 'text') return false;
    var selected = effectiveSelected(ctx, node.question);
    if (!selected || selected.length === 0) return false; // 未回答・非表示は全演算子で false
    var operand = node[op];
    var single = hasOwn(SINGLE_VALUE_TYPES, question.type);

    if (op === 'equals' || op === 'notEquals') {
      if (!single || !isNonEmptyString(operand)) return false;
      return op === 'equals' ? selected[0] === operand : selected[0] !== operand;
    }
    if (op === 'in') {
      if (!single || !Array.isArray(operand)) return false;
      return contains(operand, selected[0]);
    }
    if (single) return false; // contains / notContains / hasAnyExcept は multiple 専用
    if (op === 'contains' || op === 'notContains') {
      if (!isNonEmptyString(operand)) return false;
      return op === 'contains' ? contains(selected, operand) : !contains(selected, operand);
    }
    if (!Array.isArray(operand)) return false; // hasAnyExcept
    return selected.some(function (id) { return !contains(operand, id); });
  }

  function evalNode(ctx, node, refTrail, depth) {
    if (depth > MAX_CONDITION_DEPTH || !isPlainObject(node)) return false;

    if (hasOwn(node, 'conditionRef')) {
      if (Object.keys(node).length !== 1) return false;
      var name = node.conditionRef;
      var table = ctx.schema && ctx.schema.conditions;
      if (typeof name !== 'string' || !isPlainObject(table) || !hasOwn(table, name)) return false;
      if (contains(refTrail, name)) return false;
      return evalNode(ctx, table[name], refTrail.concat([name]), depth + 1);
    }

    var groups = GROUP_OPERATORS.filter(function (op) { return hasOwn(node, op); });
    if (groups.length > 0) {
      if (groups.length !== 1 || Object.keys(node).length !== 1) return false;
      var children = node[groups[0]];
      if (!Array.isArray(children) || children.length === 0) return false;
      var results = children.map(function (child) { return evalNode(ctx, child, refTrail, depth + 1); });
      return groups[0] === 'all'
        ? results.every(function (r) { return r === true; })
        : results.some(function (r) { return r === true; });
    }

    return evalLeaf(ctx, node);
  }

  /* ── 公開API: condition / visibility ── */

  /* condition 1件を評価する。条件なし（null / undefined）は true、不正・未知は false。 */
  function evalCondition(schema, condition, answers) {
    if (condition === undefined || condition === null) return true;
    return evalNode(createContext(schema, answers), condition, [], 0);
  }

  /* 名前付き condition（schema.conditions）を評価する。未定義名は false。 */
  function evalNamedCondition(schema, name, answers) {
    return evalCondition(schema, { conditionRef: name }, answers);
  }

  /* 設問が現在表示対象か。親が非表示のときも false。 */
  function isVisible(schema, questionId, answers) {
    return visibleIn(createContext(schema, answers), questionId);
  }

  /* 表示対象の設問ID一覧（schema順）。 */
  function visibleQuestionIds(schema, answers) {
    var ctx = createContext(schema, answers);
    return ctx.order.filter(function (id) { return visibleIn(ctx, id); });
  }

  function visibleQuestions(schema, answers) {
    var ctx = createContext(schema, answers);
    return ctx.order
      .filter(function (id) { return visibleIn(ctx, id); })
      .map(function (id) { return ctx.byId[id]; });
  }

  /* visible な設問のうち required なものだけ。required 判定の対象はここに限る。 */
  function requiredQuestionIds(schema, answers) {
    return visibleQuestions(schema, answers)
      .filter(function (q) { return q.required === true; })
      .map(function (q) { return q.id; });
  }

  /* ── dynamic option ── */

  /*
   * single_dynamic の候補。sourceQuestion（visible）で選択済みの stable option ID だけを、
   * source の option 順で返し、excludeOptionIds を除く。other 自由記述本文は候補にもIDにもしない。
   * sourceが非表示・未回答・不正なら空。
   */
  function dynamicCandidates(ctx, question) {
    if (!question || question.type !== 'single_dynamic') return [];
    var source = questionOf(ctx, question.sourceQuestion);
    if (!source || source.type !== 'multiple') return [];
    var selected = effectiveSelected(ctx, source.id);
    if (!selected || selected.length === 0) return [];
    var excluded = Array.isArray(question.excludeOptionIds) ? question.excludeOptionIds : [];
    var result = [];
    getOptions(ctx.schema, source).forEach(function (option) {
      if (!contains(selected, option.id) || contains(excluded, option.id)) return;
      var candidate = {};
      Object.keys(option).forEach(function (key) {
        if (key !== 'other' && key !== 'exclusive') candidate[key] = option[key];
      });
      candidate.sourceOptionId = option.id;
      if (option.other) candidate.fromOther = true; // 本文ではなく「その他」というIDで候補化する
      result.push(candidate);
    });
    return result;
  }

  function getDynamicOptions(schema, questionId, answers) {
    var ctx = createContext(schema, answers);
    return dynamicCandidates(ctx, questionOf(ctx, questionId));
  }

  /* 表示時に使う選択肢。single_dynamic は候補、それ以外は schema の options。 */
  function getEffectiveOptions(schema, questionId, answers) {
    var ctx = createContext(schema, answers);
    var question = questionOf(ctx, questionId);
    if (!question) return [];
    return question.type === 'single_dynamic' ? dynamicCandidates(ctx, question) : getOptions(schema, question);
  }

  /* autoSelectIfSingle: 候補が1件のとき自動選択すべき option ID。それ以外は null。 */
  function autoSelectValue(schema, questionId, answers) {
    var ctx = createContext(schema, answers);
    var question = questionOf(ctx, questionId);
    if (!question || question.type !== 'single_dynamic' || question.autoSelectIfSingle !== true) return null;
    if (!visibleIn(ctx, questionId)) return null;
    var candidates = dynamicCandidates(ctx, question);
    return candidates.length === 1 ? candidates[0].id : null;
  }

  /* ── multiple / exclusive / other ── */

  /*
   * multiple の選択変更を適用した新しい配列を返す（入力は変更しない）。
   *  - exclusive:true の option を選ぶと、他の選択を解除してそれだけにする。
   *  - 他の option を選ぶと exclusive を解除する。
   * 結果は schema の option 順に整える。
   */
  function applyMultipleSelection(schema, questionId, current, optionId, checked) {
    var question = getQuestion(schema, questionId);
    if (!question || question.type !== 'multiple') return [];
    var options = getOptions(schema, question);
    var option = null;
    options.forEach(function (o) { if (o.id === optionId) option = o; });
    var base = selectedIds(question, current);
    if (!option) return options.map(function (o) { return o.id; }).filter(function (id) { return contains(base, id); });

    var next;
    if (!checked) {
      next = base.filter(function (id) { return id !== optionId; });
    } else if (option.exclusive) {
      next = [optionId];
    } else {
      var exclusiveIds = options.filter(function (o) { return o.exclusive; }).map(function (o) { return o.id; });
      next = base.filter(function (id) { return !contains(exclusiveIds, id); });
      if (!contains(next, optionId)) next.push(optionId);
    }
    return options.map(function (o) { return o.id; }).filter(function (id) { return contains(next, id); });
  }

  /*
   * その他（other:true）option の本文入力が必要か。
   * 返り値: {required, optionIds, maxLength}。本文を持たないdynamic設問・textは常に required:false。
   */
  function otherTextInfo(schema, questionId, value) {
    var question = getQuestion(schema, questionId);
    var info = { required: false, optionIds: [], maxLength: null };
    if (!question || (question.type !== 'single' && question.type !== 'multiple')) return info;
    var otherIds = getOptions(schema, question)
      .filter(function (o) { return o.other === true; })
      .map(function (o) { return o.id; });
    info.optionIds = otherIds;
    if (typeof question.otherMaxLength === 'number') info.maxLength = question.otherMaxLength;
    info.required = selectedIds(question, value).some(function (id) { return contains(otherIds, id); });
    return info;
  }

  /* ── scale / ordinal ── */

  /*
   * scale 定義。points は min..max の昇順（schema定義の順序）、notApplicable は尺度外の独立値。
   * orderedIds は ordinal 順に使うID（notApplicable を含まない）、allIds は入力として有効な全ID。
   */
  function describeScale(question) {
    if (!question || question.type !== 'scale' || !isFinite(question.min) || !isFinite(question.max) || question.min > question.max) {
      return null;
    }
    var anchors = isPlainObject(question.anchors) ? question.anchors : {};
    var points = [];
    for (var n = question.min; n <= question.max; n++) {
      points.push({ id: String(n), value: n, label: hasOwn(anchors, String(n)) ? anchors[String(n)] : String(n) });
    }
    var na = isPlainObject(question.notApplicable) && isNonEmptyString(question.notApplicable.id)
      ? { id: question.notApplicable.id, label: question.notApplicable.label }
      : null;
    var orderedIds = points.map(function (p) { return p.id; });
    return {
      points: points,
      notApplicable: na,
      orderedIds: orderedIds,
      allIds: na ? orderedIds.concat([na.id]) : orderedIds.slice()
    };
  }

  function getScale(schema, questionId) {
    return describeScale(getQuestion(schema, questionId));
  }

  /*
   * 公開結果で順序を壊さないための並び。
   *   orderedIds    : ordinal 軸（scale は min..max、ordinal:true の選択式は option 定義順）
   *   independentIds: 尺度外の独立値（notApplicable）。orderedIds に混ぜない。
   * ordinal でない設問は null（並びは publication.sort に従う）。
   */
  function ordinalOrder(schema, questionId) {
    var question = getQuestion(schema, questionId);
    if (!question) return null;
    if (question.type === 'scale') {
      var scale = describeScale(question);
      return scale ? { orderedIds: scale.orderedIds.slice(), independentIds: scale.notApplicable ? [scale.notApplicable.id] : [] } : null;
    }
    if (isPlainObject(question.publication) && question.publication.ordinal === true) {
      return { orderedIds: getOptions(schema, question).map(function (o) { return o.id; }), independentIds: [] };
    }
    return null;
  }

  /* ── publication ── */

  /*
   * question.publication が公開設定の唯一の正本。別の公開設定一覧は作らない。
   * 返り値は schema の object の浅いコピー（schema を汚さない）。無ければ null。
   */
  function getPublication(schema, questionId) {
    var question = getQuestion(schema, questionId);
    if (!question || !isPlainObject(question.publication)) return null;
    var copy = {};
    Object.keys(question.publication).forEach(function (key) { copy[key] = question.publication[key]; });
    return copy;
  }

  function isPublic(schema, questionId) {
    var publication = getPublication(schema, questionId);
    return !!publication && publication.visibility === 'public';
  }

  /* publication.visibility === 'public' の設問ID（schema順）。 */
  function publicQuestionIds(schema) {
    return questionIds(schema).filter(function (id) { return isPublic(schema, id); });
  }

  /*
   * 分母。schema の denominator: question_reached を正とする。
   * Public payload の targetCount は「その設問に実際に到達した有効回答者数」＝ question_reached であり、別概念ではない。
   * 返り値は schema の値のまま（未指定は null）。
   */
  function denominatorOf(schema, questionId) {
    var publication = getPublication(schema, questionId);
    return publication && isNonEmptyString(publication.denominator) ? publication.denominator : null;
  }

  /*
   * 設問に到達した回答者数（= targetCount）。
   * records: 有効回答の answers の配列。その answers の下で設問が visible のものを数える。
   * 回答の有無ではなく到達（表示対象になったこと）で数える。
   */
  function countQuestionReached(schema, questionId, records) {
    if (!Array.isArray(records)) return 0;
    var count = 0;
    records.forEach(function (answers) { if (isVisible(schema, questionId, answers)) count++; });
    return count;
  }

  /* ── hidden / stale value ── */

  /*
   * 有効回答として扱えない値の検出。
   *   hidden            : 設問が非表示なのに値が残っている
   *   option_unavailable: single_dynamic の値が現在の候補にない（sourceの選択変更で消えた）
   *   other_text_stale  : 「その他」が選ばれていないのに本文が残っている／設問が非表示
   * 返り値: [{questionId, reason, field}]  field は 'answers' | 'other_texts'
   */
  function findStaleValues(schema, answers, otherTexts) {
    var ctx = createContext(schema, answers);
    var others = isPlainObject(otherTexts) ? otherTexts : {};
    var stale = [];
    ctx.order.forEach(function (id) {
      var question = ctx.byId[id];
      var hasAnswer = hasOwn(ctx.answers, id) && !isEmptyValue(question, ctx.answers[id]);
      var hasOther = hasOwn(others, id) && others[id] !== undefined;
      if (!visibleIn(ctx, id)) {
        if (hasAnswer) stale.push({ questionId: id, reason: 'hidden', field: 'answers' });
        if (hasOther) stale.push({ questionId: id, reason: 'hidden', field: 'other_texts' });
        return;
      }
      if (hasAnswer && question.type === 'single_dynamic') {
        var ids = dynamicCandidates(ctx, question).map(function (c) { return c.id; });
        if (!contains(ids, ctx.answers[id])) stale.push({ questionId: id, reason: 'option_unavailable', field: 'answers' });
      }
      if (hasOther && !otherTextInfo(schema, id, ctx.answers[id]).required) {
        stale.push({ questionId: id, reason: 'other_text_stale', field: 'other_texts' });
      }
    });
    return stale;
  }

  /*
   * stale な値を取り除いた answers / other_texts の新しい object を返す（入力は変更しない）。
   * dynamic の旧値が消える場合は、その下流の可視性も変わるため、変化がなくなるまで繰り返す。
   * 未知のkeyも残さない。removed に除去した項目を返す。
   */
  function sanitizeAnswers(schema, answers, otherTexts) {
    var cleanAnswers = {};
    var cleanOthers = {};
    var src = isPlainObject(answers) ? answers : {};
    var srcOthers = isPlainObject(otherTexts) ? otherTexts : {};
    var known = {};
    questionIds(schema).forEach(function (id) { known[id] = true; });
    Object.keys(src).forEach(function (key) { if (hasOwn(known, key)) cleanAnswers[key] = src[key]; });
    Object.keys(srcOthers).forEach(function (key) { if (hasOwn(known, key)) cleanOthers[key] = srcOthers[key]; });

    var removed = [];
    for (var round = 0; round < 64; round++) {
      var stale = findStaleValues(schema, cleanAnswers, cleanOthers);
      if (stale.length === 0) break;
      stale.forEach(function (item) {
        var target = item.field === 'answers' ? cleanAnswers : cleanOthers;
        if (hasOwn(target, item.questionId)) {
          delete target[item.questionId];
          removed.push(item);
        }
      });
    }
    return { answers: cleanAnswers, other_texts: cleanOthers, removed: removed };
  }

  /* ── 回答の検証（Frontend / Public GAS 共通） ── */

  /*
   * answers: {questionId: single/single_dynamic=string | multiple=string[] | scale=整数 or notApplicable.id | text=string}
   * otherTexts: {questionId: string}（「その他」選択時のみ）
   * 未知のkey・非表示設問の回答・不正な型/選択肢は無視せずエラーにする。
   * required は表示対象の設問だけが対象。clean は正規化済み（scale は文字列ID、text は trim）。
   * エラー code: invalid_type / unknown_field / hidden_field / required / invalid_option /
   *              duplicate_option / exclusive_conflict / invalid_text / too_long /
   *              other_text_required / other_text_unexpected / unknown_question_type
   */
  function validateAnswers(schema, answers, otherTexts) {
    var errors = [];
    var clean = { answers: {}, other_texts: {} };
    function fail(field, code) { errors.push({ field: field, code: code }); }

    if (!isPlainObject(answers)) { fail('answers', 'invalid_type'); return { ok: false, errors: errors, clean: clean }; }
    var others = otherTexts === undefined ? {} : otherTexts;
    if (!isPlainObject(others)) { fail('other_texts', 'invalid_type'); return { ok: false, errors: errors, clean: clean }; }

    var ctx = createContext(schema, answers);
    Object.keys(answers).forEach(function (key) { if (!hasOwn(ctx.byId, key)) fail(key, 'unknown_field'); });
    Object.keys(others).forEach(function (key) {
      var q = questionOf(ctx, key);
      var hasOtherOption = q && getOptions(schema, q).some(function (o) { return o.other === true; });
      if (!hasOtherOption) fail(key, 'unknown_field');
    });

    ctx.order.forEach(function (id) {
      var question = ctx.byId[id];
      var value = hasOwn(answers, id) ? answers[id] : undefined;
      var otherValue = hasOwn(others, id) ? others[id] : undefined;

      if (!visibleIn(ctx, id)) {
        if (!isEmptyValue(question, value) || otherValue !== undefined) fail(id, 'hidden_field');
        return;
      }
      if (!isKnownType(question.type)) { fail(id, 'unknown_question_type'); return; }

      var selected = [];
      var empty = isEmptyValue(question, value);

      if (question.type === 'text') {
        if (empty) {
          if (question.required) fail(id, 'required');
        } else if (typeof value !== 'string') {
          fail(id, 'invalid_type');
        } else if (CONTROL_CHARS.test(value) || (question.inputStyle === 'single_line' && /[\r\n]/.test(value))) {
          fail(id, 'invalid_text');
        } else {
          var text = normalizeText(value);
          if (typeof question.maxLength === 'number' && charLength(text) > question.maxLength) fail(id, 'too_long');
          else clean.answers[id] = text;
        }
      } else if (question.type === 'multiple') {
        if (empty) {
          if (question.required) fail(id, 'required');
        } else if (!Array.isArray(value)) {
          fail(id, 'invalid_type');
        } else {
          var options = getOptions(schema, question);
          var seen = {};
          var bad = null;
          value.forEach(function (item) {
            if (typeof item !== 'string') bad = bad || 'invalid_type';
            else if (!options.some(function (o) { return o.id === item; })) bad = bad || 'invalid_option';
            else if (seen[item]) bad = bad || 'duplicate_option';
            seen[item] = true;
          });
          var hasExclusive = options.some(function (o) { return o.exclusive && seen[o.id]; });
          if (bad) fail(id, bad);
          else if (hasExclusive && value.length > 1) fail(id, 'exclusive_conflict');
          else { selected = value.slice(); clean.answers[id] = value.slice(); }
        }
      } else {
        // single / single_dynamic / scale
        var allowed;
        if (question.type === 'single') allowed = getOptions(schema, question).map(function (o) { return o.id; });
        else if (question.type === 'single_dynamic') allowed = dynamicCandidates(ctx, question).map(function (c) { return c.id; });
        else {
          var scale = describeScale(question);
          allowed = scale ? scale.allIds : [];
        }
        if (empty) {
          if (question.required) fail(id, 'required');
        } else if (typeof value !== 'string' && !(question.type === 'scale' && typeof value === 'number')) {
          fail(id, 'invalid_type');
        } else {
          var normalized = selectedIds(question, value)[0];
          if (!contains(allowed, normalized)) fail(id, 'invalid_option');
          else { selected = [normalized]; clean.answers[id] = normalized; }
        }
      }

      var info = otherTextInfo(schema, id, question.type === 'multiple' ? selected : selected[0]);
      if (info.required) {
        if (typeof otherValue !== 'string') {
          fail(id, 'other_text_required');
        } else if (CONTROL_CHARS.test(otherValue)) {
          fail(id, 'invalid_text');
        } else {
          var otherText = normalizeText(otherValue);
          if (!otherText) fail(id, 'other_text_required');
          else if (info.maxLength !== null && charLength(otherText) > info.maxLength) fail(id, 'too_long');
          else clean.other_texts[id] = otherText;
        }
      } else if (otherValue !== undefined) {
        fail(id, 'other_text_unexpected');
      }
    });

    return { ok: errors.length === 0, errors: errors, clean: clean };
  }

  /* ── termination ── */

  /*
   * 設問の termination（例: age_confirmed = no → ineligible）に該当するか。
   * 該当する最初の設問を返す。visible な設問のみ対象。無ければ null。
   */
  function findTermination(schema, answers) {
    var ctx = createContext(schema, answers);
    for (var i = 0; i < ctx.order.length; i++) {
      var q = ctx.byId[ctx.order[i]];
      if (!isPlainObject(q.termination) || !visibleIn(ctx, q.id)) continue;
      if (selectedIds(q, ctx.answers[q.id]).indexOf(q.termination.when) !== -1) {
        return { questionId: q.id, status: q.termination.status };
      }
    }
    return null;
  }

  /* ── test mode（response_mode + test_run_id が正本） ── */

  /*
   * schema.testModes から mode の扱いを引く。未知の mode は null（fail-closed）。
   *   clientOnly     : serverへ送信しない（preview_no_submit / closed_view）。test token は不要。
   *   serverVerified : serverがtest tokenを検証してmodeを確定する（submit_excluded）。
   *   responseMode   : 保存時の response_mode。production = 'production'、submit_excluded = 'test'、client-only = null。
   *   countInValidResponses: 本番の有効回答数へ含めるか。
   * token の検証・保存はここでは行わない（#380）。
   */
  function getTestMode(schema, modeId) {
    var testModes = isPlainObject(schema) ? schema.testModes : null;
    if (!isPlainObject(testModes) || !isPlainObject(testModes.modes) || typeof modeId !== 'string' || !hasOwn(testModes.modes, modeId)) {
      return null;
    }
    var def = testModes.modes[modeId];
    var activation = isPlainObject(testModes.activation) ? testModes.activation : {};
    var clientOnly = Array.isArray(activation.clientOnlyModes) && contains(activation.clientOnlyModes, modeId);
    var serverVerified = Array.isArray(activation.serverVerifiedModes) && contains(activation.serverVerifiedModes, modeId);
    var responseMode = null;
    if (!clientOnly) {
      if (isPlainObject(def.responseMarker) && def.responseMarker.field === 'response_mode') responseMode = def.responseMarker.value;
      else if (def.submitBehavior === 'save' && modeId === 'production') responseMode = 'production';
    }
    return {
      id: modeId,
      clientOnly: clientOnly,
      serverVerified: serverVerified,
      responseMode: typeof responseMode === 'string' ? responseMode : null,
      countInValidResponses: def.countInValidResponses === true
    };
  }

  /* 本番集計へ含めてよい response_mode か。欠損・未知値は含めない（fail-closed）。 */
  function isProductionResponseMode(responseMode) { return responseMode === 'production'; }

  return {
    getQuestions: getQuestions,
    getQuestion: getQuestion,
    questionIds: questionIds,
    getOptions: getOptions,
    charLength: charLength,
    normalizeText: normalizeText,
    selectedIds: selectedIds,
    evalCondition: evalCondition,
    evalNamedCondition: evalNamedCondition,
    isVisible: isVisible,
    visibleQuestionIds: visibleQuestionIds,
    visibleQuestions: visibleQuestions,
    requiredQuestionIds: requiredQuestionIds,
    getDynamicOptions: getDynamicOptions,
    getEffectiveOptions: getEffectiveOptions,
    autoSelectValue: autoSelectValue,
    applyMultipleSelection: applyMultipleSelection,
    otherTextInfo: otherTextInfo,
    getScale: getScale,
    ordinalOrder: ordinalOrder,
    getPublication: getPublication,
    isPublic: isPublic,
    publicQuestionIds: publicQuestionIds,
    denominatorOf: denominatorOf,
    countQuestionReached: countQuestionReached,
    findStaleValues: findStaleValues,
    sanitizeAnswers: sanitizeAnswers,
    validateAnswers: validateAnswers,
    findTermination: findTermination,
    getTestMode: getTestMode,
    isProductionResponseMode: isProductionResponseMode
  };
})();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = SurveyCore;
}


/*
 * 名古屋野球ユニ部アンケート（design v2.17）：Admin 集計・publication 判定・privacy-safe snapshot 生成（Issue #382）。
 *
 * 設計方針
 *  - 副作用なし。Spreadsheet・時刻・乱数・storage・network に触れない（行オブジェクトと Date を引数で受け取る）。
 *  - 設問ID・option・分岐・公開閾値をここにベタ書きしない。すべて schema（question.publication が唯一の正本）と
 *    専用 survey-core（SurveyCore）を参照する。
 *  - denominator は schema の question_reached。targetCount は SurveyCore.countQuestionReached と同じ概念
 *    （その設問に実際に到達した有効回答者数）で、別概念を作らない。
 *  - public snapshot を作る処理（buildSnapshot）は、自由記述・「その他」本文・respondent_hash・詳細地域を入力として受け取らない。
 *    classifyRows が自由記述を valid record の answers から分離する。
 *
 * ES5記法。ブラウザ・Apps Script V8・Node.js のいずれでも動く。Node.js では module.exports でも公開する（tests用）。
 */
var SurveyAggregate = (function (core) {
  'use strict';

  var SNAPSHOT_VERSION = 1;
  var REGION_ID = 'region_blocks';
  /* publication.sensitiveBranch:true の設問が公開されるための最小 targetCount の下限（schema が緩んでも下回らせない）。 */
  var SENSITIVE_BRANCH_MIN_TARGET = 20;
  /* 回答件数表示：この件数未満は数値を出さない／以降は LIVE_COUNT_STEP 件単位で切り下げる（publicationPolicy.liveCount）。 */
  var LIVE_COUNT_MIN = 10;
  var LIVE_COUNT_STEP = 10;
  var DAY_MS = 24 * 60 * 60 * 1000;
  var PRODUCTION_STATUS = 'complete';

  /* snapshot の publish state */
  var STATE_PUBLISHED = 'published';
  var STATE_INSUFFICIENT = 'insufficient';
  var STATE_SENSITIVE_WITHHELD = 'sensitive_withheld';
  var STATE_SUPPRESSED_ALL = 'suppressed_all';

  /* public snapshot に絶対に出さないキー名（個票・system field・private 設問）。 */
  var FORBIDDEN_KEYS = [
    'respondent_hash', 'uuid', 'timestamp', 'source_channel', 'client_elapsed_ms', 'other_texts', 'free_text',
    'test_run_id', 'notification_status', 'response_mode', 'completion_status', 'answers', 'rows', 'records'
  ];

  function hasOwn(obj, key) { return Object.prototype.hasOwnProperty.call(obj, key); }
  function isPlainObject(value) { return value !== null && typeof value === 'object' && !Array.isArray(value); }
  function contains(list, item) { return list.indexOf(item) !== -1; }
  var UNANSWERED_LABEL = '未回答';

  function str(value) { return value === undefined || value === null ? '' : String(value); }

  /* ── 行 → 有効回答 ── */

  /* 保存形式 '|a|b|' の複数選択を ID 配列へ。空・不正は空配列。 */
  function decodeMultiple(cell) {
    if (Array.isArray(cell)) return cell.slice();
    var text = str(cell);
    if (text === '') return [];
    return text.split('|').filter(function (part) { return part !== ''; });
  }

  /* 行オブジェクト（列名 → セル値）から answers / other_texts を復元する。復元できない行は null。 */
  function rowToAnswers(schema, row) {
    var answers = {};
    core.getQuestions(schema).forEach(function (q) {
      var cell = hasOwn(row, q.id) ? row[q.id] : '';
      if (cell === '' || cell === undefined || cell === null) return;
      if (q.type === 'multiple') {
        var ids = decodeMultiple(cell);
        if (ids.length) answers[q.id] = ids;
      } else if (q.type === 'text') {
        answers[q.id] = str(cell);
      } else {
        answers[q.id] = str(cell);
      }
    });
    var others = {};
    var rawOthers = str(row.other_texts);
    if (rawOthers !== '') {
      try { others = JSON.parse(rawOthers); } catch (e) { return null; }
      if (!isPlainObject(others)) return null;
    }
    return { answers: answers, other_texts: others };
  }

  function emptyExcluded() {
    return {
      unknown_response_mode: 0, incomplete: 0, version_mismatch: 0, malformed: 0,
      ineligible: 0, schema_invalid: 0, missing_hash: 0, duplicate: 0
    };
  }

  /* ── version system field の比較 ── */

  var VERSION_FIELDS = ['survey_version', 'schema_version', 'design_version'];
  var SHEETS_EPOCH_OFFSET_DAYS = 25569; /* 1899-12-30 → 1970-01-01 の日数（Sheets の日付シリアル値の起点） */

  /*
   * 保存仕様では version は文字列。Sheets が "1" / "2.18" を数値へ自動変換した場合に限り、
   * 数値を文字列表現（String(n)）で比較して許容する。それ以外の型変換（真偽値・前後空白付き文字列など）は
   * 同一視しない（fail-closed）。
   * 例外（#422 Owner 判断）: survey_version だけは、schema 側が YYYY-MM で、actual が有限 number かつ
   * 期待月の月初の日付シリアル値と完全一致する場合に限り、Sheets が "2026-10" を日付化した既存行として一致扱いにする。
   * schema_version / design_version には広げない。
   */
  function isLegacyDateSerial(expected, actual, field) {
    if (field !== 'survey_version' || typeof actual !== 'number' || !isFinite(actual)) return false;
    var serial = monthStartSerial(expected);
    return serial !== null && actual === serial;
  }

  function versionMatches(expected, actual, field) {
    if (typeof actual === 'string') return actual === expected;
    if (typeof actual === 'number') return isFinite(actual) && (String(actual) === expected || isLegacyDateSerial(expected, actual, field));
    return false;
  }

  /* 文字列/数値の通常一致ではなく、月初日付シリアルの互換認識で一致した field か。 */
  function isLegacyAccepted(schema, row, field) {
    var expected = str(schema[field]);
    return isLegacyDateSerial(expected, row[field], field) && String(row[field]) !== expected;
  }

  /* 不一致の version field 名の配列（一致なら空）。classifyRows と diagnoseVersions が同じ判定を使う。 */
  function mismatchedVersionFields(schema, row) {
    return VERSION_FIELDS.filter(function (field) { return !versionMatches(str(schema[field]), row[field], field); });
  }

  /* classifyRows が version 比較へ進める行（production かつ complete）。診断も同じ条件で対象行を決める。 */
  function reachesVersionCheck(row) {
    return isPlainObject(row) && core.isProductionResponseMode(str(row.response_mode)) &&
      str(row.response_mode) !== 'test' && str(row.completion_status) === PRODUCTION_STATUS;
  }

  function emptyVersionFieldCounts() {
    var counts = {};
    VERSION_FIELDS.forEach(function (field) { counts[field] = 0; });
    return counts;
  }

  /* 'YYYY-MM' の月初を Sheets の日付シリアル値にしたもの。形式が違えば null。 */
  function monthStartSerial(text) {
    var m = /^(\d{4})-(\d{2})$/.exec(text);
    if (!m || Number(m[2]) < 1 || Number(m[2]) > 12) return null;
    return Date.UTC(Number(m[1]), Number(m[2]) - 1, 1) / 86400000 + SHEETS_EPOCH_OFFSET_DAYS;
  }

  /* API が返した値の型と、値そのものを出さない安全な分類。 */
  function describeVersionValue(expected, actual) {
    if (actual === undefined || actual === null || actual === '') return { api_type: 'empty', shape: 'empty' };
    if (typeof actual === 'string') {
      return { api_type: 'string', shape: actual.trim() === expected ? 'string_whitespace_variant' : 'string_other' };
    }
    if (typeof actual === 'number') {
      var serial = monthStartSerial(expected);
      var shape;
      if (!isFinite(actual)) shape = 'number_other';
      else if (serial !== null && actual === serial) shape = 'date_serial_of_expected_month';
      else if (Math.floor(actual) === actual && actual >= 36526 && actual <= 73050) shape = 'date_serial_other';
      else shape = 'number_other';
      return { api_type: 'number', shape: shape };
    }
    return { api_type: typeof actual === 'boolean' ? 'boolean' : 'other', shape: typeof actual === 'boolean' ? 'boolean' : 'other' };
  }

  /*
   * version_mismatch の原因診断。行ごとの値・回答本文・hash・timestamp は返さない（件数と型の分類だけ）。
   *   rows: Sheets API（UNFORMATTED_VALUE）が返した値の行オブジェクト
   *   displayRows: 同じ行の表示値（FORMATTED_VALUE）の行オブジェクト（任意。行の並びは rows と同じ）
   * display_matches_expected が true なのに mismatch なら、画面表示ではなく API が返した型・値が原因（Sheets の自動型変換）。
   */
  function diagnoseVersions(schema, rows, displayRows) {
    var list = Array.isArray(rows) ? rows : [];
    var display = Array.isArray(displayRows) ? displayRows : null;
    var expected = {};
    VERSION_FIELDS.forEach(function (field) { expected[field] = str(schema[field]); });
    var result = {
      expected: expected,
      rows_checked: 0,
      mismatch_rows: 0,
      mismatch_by_field: emptyVersionFieldCounts(),
      legacy_date_serial_accepted_rows: 0,
      display_equal_api_differs_rows: display ? 0 : null,
      observed: {}
    };
    VERSION_FIELDS.forEach(function (field) { result.observed[field] = []; });
    var groups = {};

    list.forEach(function (row, index) {
      if (!reachesVersionCheck(row)) return;
      result.rows_checked++;
      var fields = mismatchedVersionFields(schema, row);
      if (!fields.length) {
        if (isLegacyAccepted(schema, row, 'survey_version')) result.legacy_date_serial_accepted_rows++;
        return;
      }
      result.mismatch_rows++;
      var displayEqual = false;
      fields.forEach(function (field) {
        result.mismatch_by_field[field]++;
        var shown = null;
        if (display) {
          var shownRow = isPlainObject(display[index]) ? display[index] : {};
          shown = str(shownRow[field]) === expected[field];
          if (shown) displayEqual = true;
        }
        var described = describeVersionValue(expected[field], row[field]);
        var key = [field, described.api_type, described.shape, String(shown)].join('|');
        if (!hasOwn(groups, key)) {
          groups[key] = { api_type: described.api_type, shape: described.shape, display_matches_expected: shown, count: 0 };
          result.observed[field].push(groups[key]);
        }
        groups[key].count++;
      });
      if (display && displayEqual) result.display_equal_api_differs_rows++;
    });
    return result;
  }

  /*
   * 行を production 有効回答とそれ以外に分ける。
   *   response_mode = test               → test_excluded（通常集計に入れない）
   *   response_mode が production 以外   → unknown_response_mode（fail-closed）
   *   completion_status != complete      → incomplete
   *   survey/schema/design version 不一致 → version_mismatch
   *   18歳未満（termination）・schema 検証失敗・hash 欠損・hash 重複 → 除外
   * options.spreadsheetTimeZone: responses Spreadsheet の timeZone（Admin の日別回答数の日付決定だけに使う）。
   * valid の各 record: {answers（text 設問を除く）, other_texts, free_text, respondent_hash}。
   * respondent_hash は重複除去のためだけに使い、public へは出さない。
   */
  function classifyRows(schema, rows, options) {
    var spreadsheetTimeZone = options && options.spreadsheetTimeZone;
    var counts = { rows: 0, production_valid: 0, test_excluded: 0, excluded: emptyExcluded(), version_mismatch_fields: emptyVersionFieldCounts(), legacy_date_serial_accepted: 0 };
    var valid = [];
    var seen = {};
    var textIds = core.getQuestions(schema).filter(function (q) { return q.type === 'text'; }).map(function (q) { return q.id; });

    (Array.isArray(rows) ? rows : []).forEach(function (row) {
      counts.rows++;
      if (!isPlainObject(row)) { counts.excluded.malformed++; return; }
      var mode = str(row.response_mode);
      if (mode === 'test') { counts.test_excluded++; return; }
      if (!core.isProductionResponseMode(mode)) { counts.excluded.unknown_response_mode++; return; }
      if (str(row.completion_status) !== PRODUCTION_STATUS) { counts.excluded.incomplete++; return; }
      var mismatched = mismatchedVersionFields(schema, row);
      if (mismatched.length) {
        counts.excluded.version_mismatch++;
        mismatched.forEach(function (field) { counts.version_mismatch_fields[field]++; });
        return;
      }
      if (isLegacyAccepted(schema, row, 'survey_version')) counts.legacy_date_serial_accepted++;
      var parsed = rowToAnswers(schema, row);
      if (!parsed) { counts.excluded.malformed++; return; }
      if (core.findTermination(schema, parsed.answers)) { counts.excluded.ineligible++; return; }
      var validation = core.validateAnswers(schema, parsed.answers, parsed.other_texts);
      if (!validation.ok) { counts.excluded.schema_invalid++; return; }
      var hash = str(row.respondent_hash);
      if (hash === '') { counts.excluded.missing_hash++; return; }
      if (hasOwn(seen, hash)) { counts.excluded.duplicate++; return; }
      seen[hash] = true;

      var answers = {};
      var freeText = {};
      Object.keys(validation.clean.answers).forEach(function (id) {
        if (contains(textIds, id)) freeText[id] = validation.clean.answers[id];
        else answers[id] = validation.clean.answers[id];
      });
      valid.push({ answers: answers, other_texts: validation.clean.other_texts, free_text: freeText, respondent_hash: hash, day: jstDayOf(row.timestamp, spreadsheetTimeZone) });
      counts.production_valid++;
    });
    return { valid: valid, counts: counts };
  }

  /* ── 日別回答数（Admin 専用。Asia/Tokyo 基準。個別 timestamp は返さず日付ごとの件数だけにする） ── */

  var JST_OFFSET_MS = 9 * 60 * 60 * 1000;
  /* Sheets の日付シリアル値 0 = 1899-12-30（その Spreadsheet の timeZone の壁時計）。 */
  var SHEETS_EPOCH_UTC_MS = Date.UTC(1899, 11, 30);

  function pad2(n) { return (n < 10 ? '0' : '') + n; }
  function ymdOfUtc(date) { return date.getUTCFullYear() + '-' + pad2(date.getUTCMonth() + 1) + '-' + pad2(date.getUTCDate()); }
  function jstYmdOfInstant(ms) { return ymdOfUtc(new Date(ms + JST_OFFSET_MS)); }
  function validYmd(y, m, d) {
    var t = new Date(Date.UTC(y, m - 1, d));
    return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d;
  }

  /* IANA タイムゾーンの、ある瞬間（ms）での UTC からの差（ms）。タイムゾーンが不正・Intl が無ければ null。 */
  function zoneOffsetMs(timeZone, instantMs) {
    try {
      var parts = new Intl.DateTimeFormat('en-US', {
        timeZone: timeZone, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric'
      }).formatToParts(new Date(instantMs));
      var v = {};
      parts.forEach(function (p) { v[p.type] = Number(p.value); });
      return Date.UTC(v.year, v.month - 1, v.day, v.hour, v.minute, v.second) - Math.floor(instantMs / 1000) * 1000;
    } catch (e) {
      return null;
    }
  }

  /* timeZone の壁時計（UTC として表した ms）→ 実際の瞬間（ms）。解決できなければ null。 */
  function wallToInstantMs(wallMs, timeZone) {
    if (typeof timeZone !== 'string' || timeZone === '') return null;
    var first = zoneOffsetMs(timeZone, wallMs);
    if (first === null) return null;
    var second = zoneOffsetMs(timeZone, wallMs - first);
    return wallMs - (second === null ? first : second);
  }

  /*
   * timestamp セル値 → 'YYYY-MM-DD'（Asia/Tokyo の日付）。解釈できなければ null（日付不明）。
   *  - Date / offset 付き ISO 文字列は瞬間そのもの → JST に変換
   *  - 日付シリアル値（UNFORMATTED_VALUE）・'yyyy-MM-dd HH:mm' 風の文字列は Spreadsheet の timeZone の壁時計
   *    → spreadsheetTimeZone で瞬間に直してから JST に変換する。spreadsheetTimeZone が不明なら null（推測しない）。
   */
  function jstDayOf(value, spreadsheetTimeZone) {
    if (value instanceof Date) {
      return isFinite(value.getTime()) ? jstYmdOfInstant(value.getTime()) : null;
    }
    var wallMs;
    if (typeof value === 'number') {
      if (!isFinite(value) || value < 1 || value > 73050) return null;
      wallMs = SHEETS_EPOCH_UTC_MS + Math.round(value * DAY_MS);
    } else {
      var text = str(value);
      if (text === '') return null;
      if (/^\d{4}-\d{2}-\d{2}T/.test(text) && /(Z|[+-]\d{2}:?\d{2})$/.test(text)) {
        var parsed = Date.parse(text);
        return isFinite(parsed) ? jstYmdOfInstant(parsed) : null;
      }
      var m = /^(\d{4})[-\/](\d{1,2})[-\/](\d{1,2})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?)?$/.exec(text);
      if (!m) return null;
      var y = Number(m[1]), mo = Number(m[2]), d = Number(m[3]);
      var hh = m[4] === undefined ? 0 : Number(m[4]), mi = m[5] === undefined ? 0 : Number(m[5]), ss = m[6] === undefined ? 0 : Number(m[6]);
      if (!validYmd(y, mo, d) || hh > 23 || mi > 59 || ss > 59) return null;
      wallMs = Date.UTC(y, mo - 1, d, hh, mi, ss);
    }
    var instant = wallToInstantMs(wallMs, spreadsheetTimeZone);
    return instant === null ? null : jstYmdOfInstant(instant);
  }

  /*
   * production 有効回答の日別件数。records は classifyRows().valid（各 record.day が JST の日付 or null）。
   * 最初の回答日〜最後の回答日を連続させ（0 件の日も含める）、日付不明は undated にまとめる。
   * sum(days.count) + undated = total = valid.length。
   */
  function dailyResponses(records) {
    var list = Array.isArray(records) ? records : [];
    var perDay = {};
    var undated = 0;
    list.forEach(function (record) {
      var day = record && record.day;
      if (typeof day !== 'string') { undated++; return; }
      perDay[day] = (perDay[day] || 0) + 1;
    });
    var keys = Object.keys(perDay).sort();
    var days = [];
    if (keys.length) {
      var cursor = Date.parse(keys[0] + 'T00:00:00Z');
      var end = Date.parse(keys[keys.length - 1] + 'T00:00:00Z');
      for (; cursor <= end; cursor += DAY_MS) {
        var key = ymdOfUtc(new Date(cursor));
        days.push({ date: key, count: perDay[key] || 0 });
      }
    }
    return { timezone: 'Asia/Tokyo', days: days, undated: undated, total: list.length };
  }

  /* ── 設問ごとの集計（exact。Admin 用。public へは suppress を通す） ── */

  /* セルの定義（schema 順）。single_dynamic は source 設問の option から excludeOptionIds を除いたもの（other は ID 'other' のまま）。 */
  function cellDefinitions(schema, question) {
    var defs = [];
    if (question.type === 'scale') {
      var scale = core.getScale(schema, question.id);
      if (!scale) return defs;
      scale.points.forEach(function (p) { defs.push({ id: p.id, label: p.label, independent: false }); });
      if (scale.notApplicable) defs.push({ id: scale.notApplicable.id, label: scale.notApplicable.label, independent: true });
      return defs;
    }
    var source = question;
    var excluded = [];
    if (question.type === 'single_dynamic') {
      source = core.getQuestion(schema, question.sourceQuestion) || { options: [] };
      excluded = Array.isArray(question.excludeOptionIds) ? question.excludeOptionIds : [];
    }
    core.getOptions(schema, source).forEach(function (o) {
      if (!contains(excluded, o.id)) defs.push({ id: o.id, label: o.label, independent: false });
    });
    return defs;
  }

  function isSingleValued(question) {
    return question.type === 'single' || question.type === 'single_dynamic' || question.type === 'scale';
  }

  /* 設問に到達した回答者の answers を集める。visibility は core の評価（countQuestionReached と同一）。 */
  function reachedAnswers(schema, questionId, answersList) {
    var out = [];
    answersList.forEach(function (answers) {
      if (core.isVisible(schema, questionId, answers)) out.push(answers);
    });
    return out;
  }

  /*
   * 設問の exact な集計表。targetCount = その設問に到達した有効回答者数（question_reached）。
   * answeredCount は到達者のうち回答が option に該当した人数。
   */
  function tallyQuestion(schema, question, answersList) {
    var reached = reachedAnswers(schema, question.id, answersList);
    var defs = cellDefinitions(schema, question);
    var counts = {};
    defs.forEach(function (d) { counts[d.id] = 0; });
    var answered = 0;
    reached.forEach(function (answers) {
      var picked = core.selectedIds(question, answers[question.id]).filter(function (id) { return hasOwn(counts, id); });
      if (picked.length) answered++;
      picked.forEach(function (id) { counts[id]++; });
    });
    return { targetCount: reached.length, answeredCount: answered, defs: defs, counts: counts };
  }

  /* 詳細都道府県 → 地方ブロックの対応（publicRegionAggregation）。 */
  function regionConfig(schema) {
    var cfg = schema && schema.publicRegionAggregation;
    return isPlainObject(cfg) && cfg.enabled === true ? cfg : null;
  }

  /* 地方ブロックの exact な集計表。詳細都道府県は戻り値に含めない。 */
  function tallyRegion(schema, answersList) {
    var cfg = regionConfig(schema);
    if (!cfg) return null;
    var excluded = Array.isArray(cfg.excludeOptionIds) ? cfg.excludeOptionIds : [];
    var blockOf = {};
    cfg.blocks.forEach(function (b) { b.prefectureOptionIds.forEach(function (id) { blockOf[id] = b.id; }); });
    var defs = cfg.blocks.map(function (b) { return { id: b.id, label: b.label, independent: false }; });
    var counts = {};
    defs.forEach(function (d) { counts[d.id] = 0; });
    var target = 0;
    answersList.forEach(function (answers) {
      if (!core.isVisible(schema, cfg.sourceQuestion, answers)) return;
      var picked = core.selectedIds(core.getQuestion(schema, cfg.sourceQuestion), answers[cfg.sourceQuestion])[0];
      if (!picked || contains(excluded, picked) || !hasOwn(blockOf, picked)) return;
      counts[blockOf[picked]]++;
      target++;
    });
    return { targetCount: target, answeredCount: target, defs: defs, counts: counts };
  }

  /* ── publication 判定 ── */

  /* 公開判定に使う閾値。schema の publication を正本とし、下限（minCell・sensitive branch の minTarget）だけ補強する。 */
  function effectiveThresholds(schema, publication) {
    var policy = schema && schema.publicationPolicy && schema.publicationPolicy.cellPrivacy;
    var minCellFloor = policy && typeof policy.defaultMinCell === 'number' ? policy.defaultMinCell : 1;
    var minTarget = Number(publication.minTarget);
    if (publication.sensitiveBranch === true) minTarget = Math.max(minTarget, SENSITIVE_BRANCH_MIN_TARGET);
    return {
      minTotal: Number(publication.minTotal),
      minTarget: minTarget,
      minCell: Math.max(Number(publication.minCell), minCellFloor)
    };
  }

  /*
   * 公開状態（セル抑止前）。
   *   production valid total < minTotal または targetCount < minTarget → 非公開
   *   （sensitiveBranch は sensitive_withheld。公開対象に達しないまま調査が終わっても仕様違反ではない）
   * visibility が public / public_derived 以外は常に非公開（null）。
   */
  function evaluatePublication(schema, publication, productionTotal, targetCount) {
    if (!isPlainObject(publication) || (publication.visibility !== 'public' && publication.visibility !== 'public_derived')) {
      return { state: null, thresholds: null, totalMet: false, targetMet: false };
    }
    var t = effectiveThresholds(schema, publication);
    var totalMet = productionTotal >= t.minTotal;
    var targetMet = targetCount >= t.minTarget;
    var state = STATE_PUBLISHED;
    if (!totalMet || !targetMet) state = publication.sensitiveBranch === true ? STATE_SENSITIVE_WITHHELD : STATE_INSUFFICIENT;
    return { state: state, thresholds: t, totalMet: totalMet, targetMet: targetMet };
  }

  /* ── small-cell / complementary suppression ── */

  /*
   * complementary suppression の計画（partition 用）。
   *  - 小セル（0 < count < minCell）を隠す。小セルがあれば、さらに「最小の公開セル」をちょうど 1 つ隠す
   *    （同数なら schema の後ろ）。件数はデータに依らない固定規則なので、公開された出力から攻撃者が逆算に使える。
   *  - そのうえで、公開された出力（公開セル・隠した合計 S・隠しうるセルの位置）と整合する「元の件数」が、
   *    どの隠しセルについても 2 通り以上あることを確認する（ambiguityHolds）。確認できなければ ok:false。
   *    合計だけでは足りない（minCell=3 で小セルが 2・2 なら、合計 4 から 2+2 に確定する）。
   * 返り値: {hiddenIds, ok}。小セルが無ければ何も隠さず ok:true。
   */
  function planPartitionHiding(defs, counts, minCell, ordered) {
    var hiddenIds = {};
    var smallSum = 0;
    var smalls = 0;
    defs.forEach(function (d) {
      var c = counts[d.id];
      if (c > 0 && c < minCell) { hiddenIds[d.id] = true; smallSum += c; smalls++; }
    });
    if (smalls === 0) return { hiddenIds: hiddenIds, ok: true };

    var extra = null;
    defs.forEach(function (d, index) {
      var c = counts[d.id];
      if (c <= 0 || hasOwn(hiddenIds, d.id)) return;
      if (!extra || c < extra.count || (c === extra.count && index > extra.index)) extra = { id: d.id, count: c, index: index };
    });
    if (!extra) return { hiddenIds: hiddenIds, ok: false };
    hiddenIds[extra.id] = true;

    var vmin = null;
    var maxTiedIndex = -1;
    defs.forEach(function (d, index) {
      var c = counts[d.id];
      if (c <= 0 || hasOwn(hiddenIds, d.id)) return;
      if (vmin === null || c < vmin) { vmin = c; maxTiedIndex = index; } else if (c === vmin) maxTiedIndex = index;
    });
    if (vmin === null) return { hiddenIds: hiddenIds, ok: false }; // 公開できるセルが残らない
    // 攻撃者から見て値が分からないセル（ordinal は隠した位置だけ。nominal は公開セル以外すべて＝ゼロ・隠したセルを区別できない）。
    var unknown = [];
    defs.forEach(function (d, index) {
      var isVisible = counts[d.id] > 0 && !hasOwn(hiddenIds, d.id);
      if (ordered ? hasOwn(hiddenIds, d.id) : !isVisible) unknown.push(index);
    });
    var sum = smallSum + extra.count;
    return { hiddenIds: hiddenIds, ok: ambiguityHolds(unknown, sum, minCell, vmin, maxTiedIndex, ordered) };
  }

  /*
   * 公開出力と整合する元の件数（世界）を、隠したセルごとに数え上げずに区間で判定する。
   * 整合する世界 = 未知セル unknown の値で、合計が sum、ちょうど 1 セルが「追加で隠した最小の公開セル」（minCell 以上
   * vmin 未満。vmin と同数なら schema の後ろのセルだけ許される）、残りが小セル（ordinal は 1..minCell-1、nominal は 0..minCell-1 で
   * 少なくとも 1 つは小セル）。どの未知セルについても取りうる値が 2 通り以上あれば、小セルの元値は一意に確定しない。
   */
  function ambiguityHolds(unknown, sum, minCell, vmin, maxTiedIndex, ordered) {
    var n = unknown.length - 1;
    var lo0 = ordered ? 1 : 0;
    var smallMax = minCell - 1;
    for (var u = 0; u < unknown.length; u++) {
      var cell = unknown[u];
      var feasible = 0;
      // i が追加で隠したセルの場合
      var upperSelf = cell > maxTiedIndex ? vmin : vmin - 1;
      if (n >= 1) {
        var loA = Math.max(n * lo0, 1);
        var hiA = n * smallMax;
        for (var x = minCell; x <= upperSelf && feasible < 2; x++) if (sum - x >= loA && sum - x <= hiA) feasible++;
      }
      // i が小セル（または nominal のゼロ）の場合：追加で隠したセルは別の未知セル j
      var hasLater = unknown.some(function (j) { return j !== cell && j > maxTiedIndex; });
      var upperExtra = hasLater ? vmin : vmin - 1;
      if (n >= 1 && upperExtra >= minCell) {
        for (var y = lo0; y <= smallMax && feasible < 2; y++) {
          var loB = minCell + (n - 1) * lo0 + (!ordered && y === 0 ? 1 : 0);
          var hiB = upperExtra + (n - 1) * smallMax;
          if (!ordered && y === 0 && n - 1 < 1) continue; // 小セルが 1 つも無くなる
          if (sum - y >= loB && sum - y <= hiB) feasible++;
        }
      }
      if (feasible < 2) return false;
    }
    return true;
  }

  /*
   * セルの抑止。
   *  1. 0 < count < minCell のセルは値を出さない（small-cell suppression）。
   *  2. partition（単一選択・scale・地域）では targetCount と他セルから隠したセルが逆算できてしまうため、
   *     planPartitionHiding で最小の公開セルも 1 つ隠し、隠したセルの元値が一意に決まらないことを確認する。
   *     確認できなければ何も公開しない（visibleNonzero:0 → suppressed_all）。
   *     多選択はセルの合計が targetCount と一致しないため補完は不要。
   * ordered:true（ordinal）は目盛りを保つため、隠したセルも位置だけ残し count:null で返す。
   * ordered:false（nominal）は隠したセル・ゼロセルを出力から除く（隠したのかゼロなのかも区別させない）。
   * showZeroCells が true のときだけゼロを 0 として出す。
   * 返り値: {cells, hidden（値を出さなかった非ゼロセル数）, visibleNonzero}
   */
  function suppressCells(defs, counts, options) {
    var minCell = options.minCell;
    var hiddenIds = {};
    if (options.partition) {
      var plan = planPartitionHiding(defs, counts, minCell, options.ordered);
      if (!plan.ok) return { cells: [], hidden: Object.keys(plan.hiddenIds).length, visibleNonzero: 0 };
      hiddenIds = plan.hiddenIds;
    } else {
      defs.forEach(function (d) { var c = counts[d.id]; if (c > 0 && c < minCell) hiddenIds[d.id] = true; });
    }
    var hiddenCount = Object.keys(hiddenIds).length;

    var visibleNonzero = 0;
    defs.forEach(function (d) { if (counts[d.id] > 0 && !hasOwn(hiddenIds, d.id)) visibleNonzero++; });

    var cells = [];
    defs.forEach(function (d) {
      var c = counts[d.id];
      var cell = { id: d.id, label: d.label };
      if (d.independent) cell.independent = true;
      if (hasOwn(hiddenIds, d.id)) {
        if (!options.ordered) return;
        cell.count = null;
        cell.suppressed = true;
      } else if (c === 0) {
        if (!options.showZeroCells) return;
        cell.count = 0;
      } else {
        cell.count = c;
      }
      cells.push(cell);
    });
    return { cells: cells, hidden: hiddenCount, visibleNonzero: visibleNonzero };
  }

  /* nominal の並び：publication.sort が count_desc なら件数降順（同数は schema の並び＝tieBreak）。それ以外は schema 順。 */
  function sortNominal(defs, counts, publication) {
    var indexed = defs.map(function (d, index) { return { def: d, index: index }; });
    if (publication.sort === 'count_desc') {
      indexed.sort(function (a, b) {
        var diff = counts[b.def.id] - counts[a.def.id];
        return diff !== 0 ? diff : a.index - b.index;
      });
    }
    return indexed.map(function (x) { return x.def; });
  }

  /* ordinal の並び：schema 順（scale は min..max、尺度外の独立値は末尾）。ordinal に sort があっても無視する。 */
  function orderOrdinal(schema, question, defs) {
    var order = core.ordinalOrder(schema, question.id);
    if (!order) return defs.slice();
    var ids = order.orderedIds.concat(order.independentIds);
    var byId = {};
    defs.forEach(function (d) { byId[d.id] = d; });
    var out = [];
    ids.forEach(function (id) { if (hasOwn(byId, id)) out.push(byId[id]); });
    defs.forEach(function (d) { if (!contains(ids, d.id)) out.push(d); }); // schema にない並びは末尾（落とさない）
    return out;
  }

  /*
   * 地域ブロックの公開用セル。小さいブロックは「その他の地域」へまとめる。
   * 単一選択と同じ planPartitionHiding を使い、まとめた先（小ブロック + 最小の公開ブロック 1 つ）が
   * 一意に逆算できないことを確認する。確認できない・公開ブロックが残らない場合は suppressed_all。
   */
  function regionCells(schema, table, publication, thresholds) {
    var cfg = regionConfig(schema);
    var plan = planPartitionHiding(table.defs, table.counts, thresholds.minCell, false);
    var mergedSum = 0;
    var mergedBlocks = 0;
    var named = [];
    table.defs.forEach(function (d, index) {
      var c = table.counts[d.id];
      if (c <= 0) return;
      if (hasOwn(plan.hiddenIds, d.id)) { mergedSum += c; mergedBlocks++; } else named.push({ def: d, count: c, index: index });
    });
    if (!plan.ok || named.length === 0) return { cells: [], hasSuppressed: mergedBlocks > 0 };
    if (publication.sort === 'count_desc') {
      named.sort(function (a, b) { return b.count !== a.count ? b.count - a.count : a.index - b.index; });
    }
    var cells = named.map(function (n) { return { id: n.def.id, label: n.def.label, count: n.count }; });
    if (mergedBlocks > 0) {
      cells.push({ id: 'other_regions', label: cfg.privacy && cfg.privacy.mergedLabel ? cfg.privacy.mergedLabel : 'その他の地域', count: mergedSum, merged: true });
    }
    return { cells: cells, hasSuppressed: mergedBlocks > 0 };
  }

  /* ── 回答件数表示 ── */

  /* 10 件未満は数値を出さず「回答受付中」。10 件以上は 10 件単位に切り下げる（正確な件数は出さない）。 */
  function liveCountDisplay(schema, productionTotal) {
    var live = schema && schema.publicationPolicy && schema.publicationPolicy.liveCount;
    var collectingLabel = live && typeof live.under10 === 'string' ? live.under10 : '回答受付中';
    var total = Math.max(0, Math.floor(Number(productionTotal) || 0));
    if (total < LIVE_COUNT_MIN) return { state: 'collecting', floor: null, label: collectingLabel };
    var floor = Math.floor(total / LIVE_COUNT_STEP) * LIVE_COUNT_STEP;
    return { state: 'counting', floor: floor, label: floor + '件以上' };
  }

  /* ── snapshot ── */

  /* 公開結果の layer（publicationPolicy.ui.sections の selector.tier）。tier が合わなければ survey_results。 */
  function sectionFor(schema, tier) {
    var sections = schema && schema.publicationPolicy && schema.publicationPolicy.ui && schema.publicationPolicy.ui.sections;
    var fallback = 'survey_results';
    if (!Array.isArray(sections)) return fallback;
    var found = fallback;
    sections.forEach(function (s) {
      if (s && s.selector && typeof s.selector.tier === 'string' && typeof tier === 'string' && contains(s.selector.tier.split('_or_'), tier)) found = s.id;
    });
    return found;
  }

  /* 公開対象の { id, label, kind, publication }（publicResultsOrder の順）。順序の不整合は例外にする。 */
  function publicEntries(schema) {
    var order = schema.publicResultsOrder;
    if (!Array.isArray(order)) throw new Error('publicResultsOrder がありません');
    var cfg = regionConfig(schema);
    var entries = [];
    var seen = {};
    order.forEach(function (id) {
      if (hasOwn(seen, id)) throw new Error('publicResultsOrder に重複があります: ' + id);
      seen[id] = true;
      if (id === REGION_ID) {
        if (!cfg) throw new Error('publicResultsOrder に region_blocks がありますが publicRegionAggregation が無効です');
        entries.push({ id: id, label: cfg.publicLabel, kind: 'region', publication: cfg.publication });
        return;
      }
      var q = core.getQuestion(schema, id);
      if (!q) throw new Error('publicResultsOrder に存在しない設問があります: ' + id);
      if (!core.isPublic(schema, id)) throw new Error('publicResultsOrder に非公開設問があります: ' + id);
      entries.push({ id: id, label: q.label, kind: 'question', question: q, publication: q.publication });
    });
    core.publicQuestionIds(schema).forEach(function (id) {
      if (!hasOwn(seen, id)) throw new Error('publicResultsOrder にない公開設問があります: ' + id);
    });
    return entries;
  }

  function entryTable(schema, entry, answersList) {
    return entry.kind === 'region' ? tallyRegion(schema, answersList) : tallyQuestion(schema, entry.question, answersList);
  }

  /* 公開 entry を 1 件作る。非公開（collecting 等）のときは targetCount・値を一切含めない。 */
  function buildPublicEntry(schema, entry, answersList, productionTotal) {
    var table = entryTable(schema, entry, answersList);
    var pub = entry.publication;
    var evaluation = evaluatePublication(schema, pub, productionTotal, table.targetCount);
    var ordinal = entry.kind === 'question' && pub.ordinal === true;
    var out = {
      id: entry.id,
      label: entry.label,
      section: sectionFor(schema, pub.tier),
      tier: pub.tier,
      type: entry.kind === 'region' ? 'region' : entry.question.type,
      ordinal: ordinal,
      state: evaluation.state,
      targetCount: null,
      cells: [],
      hasSuppressedCells: false
    };
    if (evaluation.state !== STATE_PUBLISHED) return out;

    var t = evaluation.thresholds;
    var shaped;
    if (entry.kind === 'region') {
      var region = regionCells(schema, table, pub, t);
      shaped = { cells: region.cells, hidden: region.hasSuppressed ? 1 : 0, visibleNonzero: region.cells.length };
    } else {
      var defs = ordinal ? orderOrdinal(schema, entry.question, table.defs) : sortNominal(table.defs, table.counts, pub);
      shaped = suppressCells(defs, table.counts, {
        minCell: t.minCell,
        partition: isSingleValued(entry.question),
        ordered: ordinal,
        showZeroCells: pub.showZeroCells === true
      });
    }
    if (shaped.visibleNonzero === 0) {
      // 値を出せるセルが無い（全セルが少数）。targetCount も出さない。
      out.state = STATE_SUPPRESSED_ALL;
      out.hasSuppressedCells = true;
      return out;
    }
    out.targetCount = table.targetCount;
    out.cells = shaped.cells;
    out.hasSuppressedCells = shaped.hidden > 0;
    return out;
  }

  function isoTime(value) {
    var date = value instanceof Date ? value : new Date(value);
    if (isNaN(date.getTime())) throw new Error('generated_at が不正です');
    return date.toISOString();
  }

  /*
   * privacy-safe snapshot。入力は valid record（classifyRows の valid）。
   * 参照するのは record.answers だけで、other_texts / free_text / respondent_hash は読まない。
   */
  function buildSnapshot(schema, validRecords, options) {
    var settings = options || {};
    var records = Array.isArray(validRecords) ? validRecords : [];
    var answersList = records.map(function (r) { return r.answers; });
    var total = answersList.length;
    var live = liveCountDisplay(schema, total);
    var cfg = regionConfig(schema);
    if (cfg && cfg.privacy && (cfg.privacy.publishPrefectureDetail !== false || cfg.privacy.publishAichiAreaDetail !== false)) {
      throw new Error('詳細都道府県・愛知県内地域は公開できません（publicRegionAggregation.privacy）');
    }
    var ui = schema.publicationPolicy && schema.publicationPolicy.ui ? schema.publicationPolicy.ui : {};
    return {
      snapshot_version: SNAPSHOT_VERSION,
      survey_id: schema.survey_id,
      survey_version: schema.survey_version,
      schema_version: schema.schema_version,
      design_version: schema.design_version,
      generated_at: isoTime(settings.generatedAt || new Date()),
      response_status: { state: live.state, label: live.label },
      production_valid_total: live.floor,
      representativeness_notice: typeof ui.representativenessNotice === 'string' ? ui.representativenessNotice : '',
      sections: Array.isArray(ui.sections) ? ui.sections.map(function (s) { return { id: s.id, label: s.label }; }) : [],
      questions: publicEntries(schema).map(function (entry) { return buildPublicEntry(schema, entry, answersList, total); })
    };
  }

  /* ── snapshot の更新判定（batch のみ。submit ごとには更新しない） ── */

  function snapshotPolicy(schema) {
    var update = schema && schema.publicationPolicy && schema.publicationPolicy.snapshotUpdate;
    var minCells = [];
    publicEntries(schema).forEach(function (e) { minCells.push(effectiveThresholds(schema, e.publication).minCell); });
    var minCell = minCells.length ? Math.max.apply(null, minCells) : 1;
    var minimumBatch = update && typeof update.minimumBatchIncrement === 'number' ? update.minimumBatchIncrement : 1;
    var countTrigger = update && typeof update.countTriggerIncrement === 'number' ? update.countTriggerIncrement : minimumBatch;
    return {
      mode: update && update.mode ? update.mode : 'batch_only',
      perResponseUpdate: false,
      // 差分から 1 件の回答が復元されないよう、どの更新でも増分は minCell 以上・minimumBatchIncrement 以上にする。
      minimumIncrement: Math.max(minimumBatch, minCell),
      countTriggerIncrement: Math.max(countTrigger, minimumBatch, minCell),
      intervalMs: DAY_MS
    };
  }

  /*
   * 新しい snapshot を公開（切替）してよいか。
   *   previous: {generated_at, production_valid_total（exact。運営側の記録）} または null（初回）
   *   current : 現在の production valid total（exact）
   * 1 日 1 回（intervalMs 経過）か、件数増分が countTriggerIncrement 以上のときだけ true。
   * どちらも増分が minimumIncrement（minCell 以上）に満たなければ更新しない。
   */
  function decideSnapshotUpdate(schema, previous, currentTotal, now) {
    var policy = snapshotPolicy(schema);
    var current = Math.max(0, Math.floor(Number(currentTotal) || 0));
    if (!previous || !previous.generated_at) return { update: true, reason: 'initial', increment: current, policy: policy };
    var prevTime = new Date(previous.generated_at).getTime();
    var nowTime = (now instanceof Date ? now : new Date(now)).getTime();
    if (isNaN(prevTime) || isNaN(nowTime)) return { update: true, reason: 'invalid_previous', increment: current, policy: policy };
    var increment = current - Math.max(0, Math.floor(Number(previous.production_valid_total) || 0));
    if (increment < policy.minimumIncrement) return { update: false, reason: 'insufficient_increment', increment: increment, policy: policy };
    if (nowTime - prevTime >= policy.intervalMs) return { update: true, reason: 'daily', increment: increment, policy: policy };
    if (increment >= policy.countTriggerIncrement) return { update: true, reason: 'count_increment', increment: increment, policy: policy };
    return { update: false, reason: 'not_due', increment: increment, policy: policy };
  }

  /* ── snapshot の検証（schema drift・privacy・suppression の不変条件） ── */

  function walkStrings(value, visit, keyVisit) {
    if (Array.isArray(value)) { value.forEach(function (v) { walkStrings(v, visit, keyVisit); }); return; }
    if (isPlainObject(value)) {
      Object.keys(value).forEach(function (k) { keyVisit(k); walkStrings(value[k], visit, keyVisit); });
      return;
    }
    if (typeof value === 'string') visit(value);
  }

  var HASH_LIKE = /^[0-9a-f]{32,}$/i;
  var UUID_LIKE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

  /*
   * snapshot が schema と整合し、private 情報を含まず、小セルを逆算できないことを検査する。
   * validateSnapshotDetailed の戻り: [{category, question_id, message}]（空なら OK）。
   *   category は固定 allowlist（VALIDATION_CATEGORIES）、question_id は schema 上の設問 ID か null。件数・セル内容は含めない。
   * validateSnapshot の戻り: 問題の文字列配列（空なら OK）。
   */
  var VALIDATION_CATEGORIES = [
    'structure', 'snapshot_version', 'version_mismatch', 'generated_at', 'response_status', 'live_count',
    'private_value_detected', 'private_key_detected', 'question_order', 'invalid_state', 'target_count',
    'cells_structure', 'small_cell_suppression', 'complementary_suppression', 'sort_order'
  ];

  /* 設問・セル定義から、その設問の公開セルが取りうる ID（option ID / scale point ID / 地方ブロック ID）。 */
  function legitimateCellIds(schema, entry) {
    var defs = entry.kind === 'region' ? (tallyRegion(schema, []) || { defs: [] }).defs : cellDefinitions(schema, entry.question);
    return defs.map(function (d) { return d.id; });
  }

  function validateSnapshotDetailed(schema, snapshot) {
    var problems = [];
    function bad(category, message, questionId) {
      problems.push({ category: category, question_id: typeof questionId === 'string' ? questionId : null, message: message });
    }
    if (!isPlainObject(snapshot)) return [{ category: 'structure', question_id: null, message: 'snapshot が object ではありません' }];
    if (snapshot.snapshot_version !== SNAPSHOT_VERSION) bad('snapshot_version', 'snapshot_version が不正です');
    ['survey_id', 'survey_version', 'schema_version', 'design_version'].forEach(function (k) {
      if (snapshot[k] !== schema[k]) bad('version_mismatch', k + ' が schema と一致しません（schema drift）');
    });
    if (isNaN(new Date(snapshot.generated_at).getTime())) bad('generated_at', 'generated_at が不正です');
    if (!isPlainObject(snapshot.response_status)) bad('response_status', 'response_status がありません');
    var total = snapshot.production_valid_total;
    if (total !== null && (typeof total !== 'number' || total < LIVE_COUNT_MIN || total % LIVE_COUNT_STEP !== 0)) {
      bad('live_count', 'production_valid_total は null か 10 件単位の切り下げ値でなければなりません');
    }
    if (isPlainObject(snapshot.response_status)) {
      if (total === null && snapshot.response_status.state !== 'collecting') bad('response_status', '10件未満は collecting でなければなりません');
      if (total !== null && snapshot.response_status.state !== 'counting') bad('response_status', '10件以上は counting でなければなりません');
    }

    var privateIds = core.questionIds(schema).filter(function (id) { return !core.isPublic(schema, id); });
    var prefectureIds = [];
    var cfg = regionConfig(schema);
    if (cfg) cfg.blocks.forEach(function (b) { prefectureIds = prefectureIds.concat(b.prefectureOptionIds); });
    var expected = [];
    try { expected = publicEntries(schema); } catch (e) { bad('structure', String(e.message || e)); }
    var byId = {};
    expected.forEach(function (e) { byId[e.id] = e; });

    /*
     * 値の文字列検査では、公開設問が自分の cells[].id として持つ「その設問の option / scale point / 地方ブロック ID」を除く。
     * これらは公開仕様上の ID で、非公開設問・詳細都道府県と同じ文字列でも別物（例: 障壁の選択肢 'age' は非公開設問 'age' とは別、
     * 地方ブロック 'overseas' は都道府県 option 'overseas' とは別）。それ以外の位置・それ以外の値は従来どおり検査する。
     */
    var scanned = JSON.parse(JSON.stringify(snapshot));
    (Array.isArray(scanned.questions) ? scanned.questions : []).forEach(function (q) {
      var entry = isPlainObject(q) ? byId[q.id] : null;
      if (!entry || !Array.isArray(q.cells)) return;
      var allowed = legitimateCellIds(schema, entry);
      q.cells.forEach(function (c) {
        if (isPlainObject(c) && typeof c.id === 'string' && contains(allowed, c.id)) c.id = '';
      });
    });
    walkStrings(scanned, function (text) {
      if (HASH_LIKE.test(text) || UUID_LIKE.test(text)) bad('private_value_detected', 'hash / UUID らしき値があります');
      if (contains(prefectureIds, text)) bad('private_value_detected', '詳細都道府県の ID があります: ' + text);
      if (contains(privateIds, text)) bad('private_value_detected', '非公開設問の ID があります: ' + text);
    }, function (key) {
      if (contains(FORBIDDEN_KEYS, key)) bad('private_key_detected', '公開してはいけないキーがあります: ' + key);
      if (contains(privateIds, key)) bad('private_key_detected', '非公開設問のキーがあります: ' + key);
    });

    var expectedIds = expected.map(function (e) { return e.id; });
    var actualIds = Array.isArray(snapshot.questions) ? snapshot.questions.map(function (q) { return q && q.id; }) : [];
    if (JSON.stringify(expectedIds) !== JSON.stringify(actualIds)) bad('question_order', 'questions の順序が publicResultsOrder と一致しません');
    (Array.isArray(snapshot.questions) ? snapshot.questions : []).forEach(function (q) {
      var entry = q && byId[q.id];
      if (!entry) return;
      var evaluation = evaluatePublication(schema, entry.publication, 0, 0);
      var t = evaluation.thresholds;
      var tag = q.id + ': ';
      if (q.state !== STATE_PUBLISHED) {
        if (!contains([STATE_INSUFFICIENT, STATE_SENSITIVE_WITHHELD, STATE_SUPPRESSED_ALL], q.state)) bad('invalid_state', tag + 'state が不正です', q.id);
        if (entry.publication.sensitiveBranch !== true && q.state === STATE_SENSITIVE_WITHHELD) bad('invalid_state', tag + 'sensitive 以外が sensitive_withheld です', q.id);
        if (q.targetCount !== null || !Array.isArray(q.cells) || q.cells.length) bad('invalid_state', tag + '非公開の項目に件数・値があります', q.id);
        return;
      }
      if (!t || typeof q.targetCount !== 'number' || q.targetCount < t.minTarget) bad('target_count', tag + 'targetCount が minTarget 未満です', q.id);
      if (!Array.isArray(q.cells) || q.cells.length === 0) { bad('cells_structure', tag + 'cells がありません', q.id); return; }
      var visibleSum = 0;
      var placeholders = 0;
      q.cells.forEach(function (c) {
        if (c.count === null) {
          if (c.suppressed !== true) bad('cells_structure', tag + 'count:null は suppressed:true が必要です', q.id);
          placeholders++;
          return;
        }
        if (typeof c.count !== 'number') { bad('cells_structure', tag + 'count が数値ではありません', q.id); return; }
        visibleSum += c.count;
        if (c.count > 0 && t && c.count < t.minCell) bad('small_cell_suppression', tag + 'minCell 未満の値が公開されています', q.id);
        if (c.count === 0 && entry.publication.showZeroCells !== true) bad('small_cell_suppression', tag + 'showZeroCells=false なのにゼロが公開されています', q.id);
      });
      // 隠した分（targetCount − 公開セルの合計）。単一セルとして逆算できてはならない。
      var partition = entry.kind === 'region' || (entry.question && isSingleValued(entry.question));
      if (partition && t) {
        var hidden = q.targetCount - visibleSum;
        if (hidden < 0) bad('target_count', tag + '公開セルの合計が targetCount を超えています', q.id);
        if (hidden > 0 && hidden < t.minCell) bad('complementary_suppression', tag + '隠したセルの合計が minCell 未満で、小セルを逆算できます', q.id);
        if (entry.kind === 'question' && entry.publication.ordinal === true && hidden > 0 && placeholders < 2) {
          bad('complementary_suppression', tag + 'ordinal で隠したセルが 1 つだけで、小セルを逆算できます', q.id);
        }
      }
      // 公開出力だけから、隠したセルの元値が一意に決まらないこと（合計だけでなく取りうる世界の数で確認する）。
      if (partition && t) {
        var defsForCheck = entry.kind === 'region' ? tallyRegion(schema, []).defs : cellDefinitions(schema, entry.question);
        var ordered = entry.kind === 'question' && entry.publication.ordinal === true;
        var shownCount = {};
        q.cells.forEach(function (c) { if (typeof c.count === 'number' && c.count > 0) shownCount[c.id] = c.count; });
        var vmin = null;
        var maxTied = -1;
        var unknown = [];
        defsForCheck.forEach(function (d, index) {
          if (hasOwn(shownCount, d.id)) {
            if (vmin === null || shownCount[d.id] < vmin) { vmin = shownCount[d.id]; maxTied = index; } else if (shownCount[d.id] === vmin) maxTied = index;
          } else if (!ordered || q.cells.some(function (c) { return c.id === d.id && c.count === null; })) {
            unknown.push(index);
          }
        });
        var hiddenTotal = q.targetCount - visibleSum;
        if (hiddenTotal > 0 && (vmin === null || !ambiguityHolds(unknown, hiddenTotal, t.minCell, vmin, maxTied, ordered))) {
          bad('complementary_suppression', tag + '公開された出力から、隠した小セルの元値を一意に逆算できます', q.id);
        }
      }
      if (entry.kind === 'question' && entry.publication.ordinal !== true && entry.publication.sort === 'count_desc') {
        for (var i = 1; i < q.cells.length; i++) {
          if (q.cells[i].count > q.cells[i - 1].count) bad('sort_order', tag + 'nominal が件数降順になっていません', q.id);
        }
      }
      if (entry.kind === 'question' && entry.publication.ordinal === true) {
        var order = core.ordinalOrder(schema, q.id);
        var actual = q.cells.map(function (c) { return c.id; });
        if (order) {
          var sorted = order.orderedIds.concat(order.independentIds).filter(function (id) { return contains(actual, id); });
          if (JSON.stringify(sorted) !== JSON.stringify(actual)) bad('sort_order', tag + 'ordinal が schema の順序になっていません', q.id);
        }
      }
    });
    return problems;
  }

  function validateSnapshot(schema, snapshot) {
    return validateSnapshotDetailed(schema, snapshot).map(function (p) { return p.message; });
  }

  /* ── semantic code 集計（Admin 分析用。public には出さない） ── */

  /*
   * 障壁（semanticCodes）と安心条件（reassuranceFor）を code ごとに回答者単位で数える。
   * 同一 respondent が同一 code に複数 option（primary / secondary を含む）から該当しても 1 人として数える。
   * 自由記述の自動分類はしない（選択済み option の code だけ）。
   */
  function analyzeSemanticCodes(schema, validRecords) {
    var answersList = (Array.isArray(validRecords) ? validRecords : []).map(function (r) { return r.answers; });
    var barrierCodes = isPlainObject(schema.barrierCodes) ? schema.barrierCodes : {};
    var sources = [];
    core.getQuestions(schema).forEach(function (q) {
      var options = core.getOptions(schema, q);
      var barrierOptions = options.filter(function (o) { return isPlainObject(o.semanticCodes); });
      var reassuranceOptions = options.filter(function (o) { return Array.isArray(o.reassuranceFor); });
      if (!barrierOptions.length && !reassuranceOptions.length) return;
      var role = barrierOptions.length ? 'barrier' : 'reassurance';
      var reached = reachedAnswers(schema, q.id, answersList);
      var perCode = {};
      reached.forEach(function (answers) {
        var seenCodes = {};
        core.selectedIds(q, answers[q.id]).forEach(function (id) {
          options.forEach(function (o) {
            if (o.id !== id) return;
            var codes = [];
            if (role === 'barrier') {
              if (isPlainObject(o.semanticCodes)) {
                codes.push(o.semanticCodes.primary);
                if (Array.isArray(o.semanticCodes.secondary)) codes = codes.concat(o.semanticCodes.secondary);
              }
            } else if (Array.isArray(o.reassuranceFor)) {
              codes = o.reassuranceFor;
            }
            codes.forEach(function (code) { if (typeof code === 'string' && code !== '') seenCodes[code] = true; });
          });
        });
        Object.keys(seenCodes).forEach(function (code) { perCode[code] = (perCode[code] || 0) + 1; });
      });
      sources.push({ questionId: q.id, role: role, targetCount: reached.length, codes: perCode });
    });

    var comparison = Object.keys(barrierCodes).map(function (code) {
      var barrier = {};
      var reassurance = {};
      var hasBarrierSource = false;
      var hasReassuranceSource = false;
      sources.forEach(function (s) {
        var n = hasOwn(s.codes, code) ? s.codes[code] : 0;
        if (s.role === 'barrier') { barrier[s.questionId] = n; hasBarrierSource = true; }
        else { reassurance[s.questionId] = n; hasReassuranceSource = true; }
      });
      // schema に、その code を安心条件として結びつけた option があるか（なければ「対応する安心条件が未設計」）。
      var covered = false;
      core.getQuestions(schema).forEach(function (q) {
        core.getOptions(schema, q).forEach(function (o) { if (Array.isArray(o.reassuranceFor) && contains(o.reassuranceFor, code)) covered = true; });
      });
      return {
        code: code,
        label: barrierCodes[code].label,
        barrier: hasBarrierSource ? barrier : {},
        reassurance: hasReassuranceSource ? reassurance : {},
        reassuranceDefined: covered
      };
    }).filter(function (row) {
      var any = false;
      Object.keys(row.barrier).forEach(function (k) { if (row.barrier[k] > 0) any = true; });
      Object.keys(row.reassurance).forEach(function (k) { if (row.reassurance[k] > 0) any = true; });
      return any || row.reassuranceDefined;
    });
    return { sources: sources, comparison: comparison };
  }

  /*
   * Admin「集計結果」カード専用の並び（Public / snapshot / publication には使わない）。
   *  - publication.ordinal === true : schema 順（意味順）を維持。
   *  - publication.sort === 'count_desc' : 件数降順（同数は schema 順）。
   *  - publication を持たない Admin 内部設問は、設問の adminTallySort === 'count_desc'（明示 allowlist）のものだけ件数降順にする。
   * 件数 0 の option も落とさない。table.defs / counts は変更しない（コピーを並べる）。
   */
  function adminTally(table, countDesc) {
    var indexed = table.defs.map(function (d, index) { return { def: d, index: index }; });
    if (countDesc) {
      indexed.sort(function (a, b) {
        var diff = table.counts[b.def.id] - table.counts[a.def.id];
        return diff !== 0 ? diff : a.index - b.index;
      });
    }
    return indexed.map(function (x) { return { id: x.def.id, label: x.def.label, count: table.counts[x.def.id] }; });
  }

  /* ── Admin サマリー（exact。運営者のみ。個票・自由記述・hash を含まない） ── */

  function buildAdminSummary(schema, classification, options) {
    var settings = options || {};
    var valid = classification.valid;
    var answersList = valid.map(function (r) { return r.answers; });
    var total = valid.length;
    var otherCounts = otherTextCounts(valid);
    var questions = publicEntries(schema).map(function (entry) {
      var table = entryTable(schema, entry, answersList);
      var evaluation = evaluatePublication(schema, entry.publication, total, table.targetCount);
      var t = evaluation.thresholds;
      var publicEntry = buildPublicEntry(schema, entry, answersList, total);
      return {
        id: entry.id,
        label: entry.label,
        type: entry.kind === 'region' ? 'region' : entry.question.type,
        tier: entry.publication.tier,
        sensitiveBranch: entry.publication.sensitiveBranch === true,
        denominator: entry.kind === 'region' ? (schema.publicRegionAggregation.denominator || 'question_reached') : (core.denominatorOf(schema, entry.id) || 'question_reached'),
        targetCount: table.targetCount,
        answeredCount: table.answeredCount,
        thresholds: t,
        totalMet: evaluation.totalMet,
        targetMet: evaluation.targetMet,
        publicState: publicEntry.state,
        hasSuppressedCells: publicEntry.hasSuppressedCells,
        /* 「その他」自由記述の件数のみ（本文は含めない。本文は getOtherTexts(questionId) で展開時に取得する）。 */
        otherTextCount: entry.kind === 'region' ? 0 : (otherCounts[entry.id] || 0),
        /* Admin 内部の exact な集計。公開閾値・suppression とは無関係に常に返す（公開側は publicPreview / buildPublicEntry を通る）。 */
        tally: adminTally(table, entry.publication.ordinal !== true && entry.publication.sort === 'count_desc')
      };
    });
    /* 公開対象外（publicResultsOrder に無い）の non-text 設問。Admin 内部集計のみ。publication / snapshot には一切渡さない。 */
    var publicIds = {};
    publicEntries(schema).forEach(function (entry) { publicIds[entry.id] = true; });
    var internalQuestions = core.getQuestions(schema).filter(function (q) {
      return q.type !== 'text' && !hasOwn(publicIds, q.id);
    }).map(function (q) {
      var table = tallyQuestion(schema, q, answersList);
      return {
        id: q.id,
        label: q.label,
        type: q.type,
        targetCount: table.targetCount,
        answeredCount: table.answeredCount,
        publicState: 'not_public',
        otherTextCount: otherCounts[q.id] || 0,
        tally: adminTally(table, q.adminTallySort === 'count_desc')
      };
    });
    var snapshot = buildSnapshot(schema, valid, { generatedAt: settings.now || new Date() });
    var decision = decideSnapshotUpdate(schema, settings.previousSnapshot || null, total, settings.now || new Date());
    return {
      survey_id: schema.survey_id,
      survey_version: schema.survey_version,
      design_version: schema.design_version,
      production_valid_total: total,
      /* Admin 専用。publicPreview / snapshot には含めない。 */
      daily_responses: dailyResponses(valid),
      test_excluded: classification.counts.test_excluded,
      excluded: classification.counts.excluded,
      version_mismatch_fields: classification.counts.version_mismatch_fields || emptyVersionFieldCounts(),
      legacy_date_serial_accepted: classification.counts.legacy_date_serial_accepted || 0,
      rows: classification.counts.rows,
      questions: questions,
      internalQuestions: internalQuestions,
      semantic: analyzeSemanticCodes(schema, valid),
      snapshotDecision: { update: decision.update, reason: decision.reason, increment: decision.increment },
      publicPreview: snapshot
    };
  }

  /* 設問ごとの「その他」自由記述の件数（本文は返さない。Admin サマリー用）。 */
  function otherTextCounts(valid) {
    var counts = {};
    valid.forEach(function (record) {
      Object.keys(record.other_texts).forEach(function (id) {
        if (str(record.other_texts[id]).trim() !== '') counts[id] = (counts[id] || 0) + 1;
      });
    });
    return counts;
  }

  /* 同一 record の単一選択設問の表示ラベル。値が無い・option に無い場合は推測せず「未回答」。 */
  function answerLabel(schema, record, questionId) {
    var question = core.getQuestion(schema, questionId);
    var ids = core.selectedIds(question, record.answers[questionId]);
    if (ids.length !== 1) return UNANSWERED_LABEL;
    var label = '';
    core.getOptions(schema, question).forEach(function (o) { if (o.id === ids[0]) label = str(o.label); });
    return label !== '' ? label : UNANSWERED_LABEL;
  }

  /* 同一 record の国。国内の都道府県は domesticLabel、海外は residence_country の保存原文。回答しない・未回答・原文なしは推測せず「未回答」。 */
  function attributionCountry(schema, record, config) {
    var ids = core.selectedIds(core.getQuestion(schema, config.prefecture), record.answers[config.prefecture]);
    if (ids.length !== 1 || contains(config.noAnswerOptionIds || [], ids[0])) return UNANSWERED_LABEL;
    if (ids[0] !== config.overseasOptionId) return str(config.domesticLabel) || UNANSWERED_LABEL;
    var raw = hasOwn(record.free_text, config.country) ? str(record.free_text[config.country]) : '';
    return raw.trim() !== '' ? raw : UNANSWERED_LABEL;
  }

  /*
   * Admin 自由記述一覧の全項目（text 設問・「その他」）に共通で、本文の末尾へ同一 record の
   * 「 （都道府県・国・年代）」を添える（schema の adminFreeTextAttribution。Admin 表示のみ）。
   * 返すのは表示ラベル・保存原文だけで、raw ID・詳細居住地・hash・timestamp は含めない。
   */
  function withAdminAttributes(schema, record, text) {
    var config = schema.adminFreeTextAttribution;
    if (!isPlainObject(config)) return text;
    var parts = [answerLabel(schema, record, config.prefecture), attributionCountry(schema, record, config), answerLabel(schema, record, config.age)];
    return text + ' （' + parts.join('・') + '）';
  }

  /* 自由記述（Admin のみ）。public snapshot の生成処理とは別関数・別ファイルで呼ぶ。個票の識別子は含めない。 */
  function listFreeText(schema, classification) {
    var textIds = core.getQuestions(schema).filter(function (q) { return q.type === 'text'; }).map(function (q) { return q.id; });
    var items = [];
    classification.valid.forEach(function (record) {
      textIds.forEach(function (id) {
        if (!hasOwn(record.free_text, id)) return;
        var text = record.free_text[id];
        items.push({ questionId: id, label: core.getQuestion(schema, id).label, text: withAdminAttributes(schema, record, text) });
      });
      Object.keys(record.other_texts).forEach(function (id) {
        items.push({ questionId: id, label: core.getQuestion(schema, id).label, kind: 'other', text: withAdminAttributes(schema, record, record.other_texts[id]) });
      });
    });
    return items;
  }

  /*
   * 指定した設問の「その他」自由記述の本文だけ（Admin のみ・展開時の lazy-load 用）。
   * 回答順から回答者を辿れないよう本文の昇順に並べ、timestamp・hash・行番号・他設問の本文は返さない。
   */
  function listOtherTexts(schema, classification, questionId) {
    var question = core.getQuestion(schema, questionId);
    if (!question) return null;
    var texts = [];
    classification.valid.forEach(function (record) {
      if (hasOwn(record.other_texts, questionId) && str(record.other_texts[questionId]).trim() !== '') texts.push(str(record.other_texts[questionId]));
    });
    texts.sort();
    return { questionId: questionId, texts: texts };
  }

  return {
    SNAPSHOT_VERSION: SNAPSHOT_VERSION,
    REGION_ID: REGION_ID,
    SENSITIVE_BRANCH_MIN_TARGET: SENSITIVE_BRANCH_MIN_TARGET,
    STATE_PUBLISHED: STATE_PUBLISHED,
    STATE_INSUFFICIENT: STATE_INSUFFICIENT,
    STATE_SENSITIVE_WITHHELD: STATE_SENSITIVE_WITHHELD,
    STATE_SUPPRESSED_ALL: STATE_SUPPRESSED_ALL,
    FORBIDDEN_KEYS: FORBIDDEN_KEYS,
    decodeMultiple: decodeMultiple,
    rowToAnswers: rowToAnswers,
    classifyRows: classifyRows,
    jstDayOf: jstDayOf,
    dailyResponses: dailyResponses,
    VERSION_FIELDS: VERSION_FIELDS,
    diagnoseVersions: diagnoseVersions,
    versionMatches: versionMatches,
    cellDefinitions: cellDefinitions,
    tallyQuestion: tallyQuestion,
    tallyRegion: tallyRegion,
    effectiveThresholds: effectiveThresholds,
    evaluatePublication: evaluatePublication,
    suppressCells: suppressCells,
    planPartitionHiding: planPartitionHiding,
    regionCells: regionCells,
    liveCountDisplay: liveCountDisplay,
    publicEntries: publicEntries,
    buildSnapshot: buildSnapshot,
    snapshotPolicy: snapshotPolicy,
    decideSnapshotUpdate: decideSnapshotUpdate,
    validateSnapshot: validateSnapshot,
    validateSnapshotDetailed: validateSnapshotDetailed,
    VALIDATION_CATEGORIES: VALIDATION_CATEGORIES,
    analyzeSemanticCodes: analyzeSemanticCodes,
    buildAdminSummary: buildAdminSummary,
    listFreeText: listFreeText,
    listOtherTexts: listOtherTexts
  };
})(typeof SurveyCore !== 'undefined' ? SurveyCore : require('./survey-core.js'));

if (typeof module !== 'undefined' && module.exports) {
  module.exports = SurveyAggregate;
}


/**
 * 名古屋野球ユニ部アンケート（Issue #425）：Public GAS が保持する privacy-safe snapshot の永続化形式。
 *
 * 副作用なしの純粋関数だけを持つ（Sheet への読み書き・時刻・digest 計算は呼び出し側が行う）。
 * Public GAS（書き込み・読み出し）と Admin GAS（readonly の状態表示）が同じ形式を解釈するために共有する。
 *
 * 保存先は Spreadsheet の専用 `public_snapshot` シート（raw responses の `responses` とは別）。
 *   A1            : メタデータ（先頭 `m:` + JSON）。**最後に**書く。これが指す slot の chunk だけが有効。
 *   B列 / C列     : slot 0 / slot 1 の chunk。1 行 1 chunk（先頭 `c:` + 最大 CHUNK_SIZE 文字）。
 * 2 つの slot を交互に使うので、書き込み途中で失敗しても直前の last-known-good（もう一方の slot）は壊れない。
 * `c:` / `m:` の接頭辞は、Sheets が数式・数値・日付として解釈するのを避ける。1 セル 50,000 文字の上限にも収まる。
 *
 *   D1            : 直近の refresh 診断（先頭 `g:` + JSON。Issue #450）。snapshot の有効性とは無関係（meta が指す chunk には影響しない）。
 *                   固定 allowlist に正規化した値（段階・結果・理由・件数・分類サマリ）だけを持ち、回答値・hash・ID・例外 message は持たない。
 *
 * 読み戻し時は meta・chunk 数・総文字数・SHA-256 を照合し、1 つでも合わなければ「無い」ものとして扱う（fail closed）。
 * snapshot 自体の privacy / suppression / version の検証は SurveyAggregate.validateSnapshot が行う。
 *
 * ES5記法。ブラウザ・Apps Script V8・Node.js のいずれでも動く。
 */
var SnapshotStore = (function () {
  'use strict';

  var STORE_VERSION = 1;
  var SLOT_COUNT = 2;
  var CHUNK_SIZE = 40000;
  var META_PREFIX = 'm:';
  var CHUNK_PREFIX = 'c:';
  var SHEET_NAME = 'public_snapshot';
  // meta に許可するキー（これ以外を含む meta は不正。個票・hash などが紛れ込む余地を作らない）。
  var STRING_KEYS = ['digest', 'generated_at', 'updated_at', 'reason', 'survey_version', 'schema_version', 'design_version'];
  var COUNT_KEYS = ['slot', 'chunks', 'length', 'exact_total'];

  // ── refresh 診断（Issue #450）：書き込み側・読み出し側の両方が同じ allowlist で正規化する（fail closed）。 ──
  var DIAG_VERSION = 1;
  var DIAG_PREFIX = 'g:';
  var DIAG_COLUMN = SLOT_COUNT + 2; // 1 始まりの列番号（D 列）。行は 1。
  var DIAG_STAGES = ['lock', 'load', 'classify', 'build', 'validate', 'plan', 'write', 'verify'];
  var DIAG_RESULTS = ['success', 'skipped', 'failed'];
  var DIAG_REASONS = ['initial', 'invalid_previous', 'daily', 'count_increment', 'insufficient_increment', 'not_due', 'busy',
    'snapshot_invalid', 'verify_failed', 'exception'];
  var DIAG_ERROR_CLASSES = ['not_configured', 'responses_sheet_missing', 'header_mismatch', 'service_quota', 'timeout', 'permission',
    'service_unavailable', 'sheet_limit', 'programming_error', 'unknown'];
  var DIAG_EXCLUDED_KEYS = ['unknown_response_mode', 'incomplete', 'version_mismatch', 'malformed', 'ineligible', 'schema_invalid', 'missing_hash', 'duplicate'];
  var DIAG_VERSION_FIELDS = ['survey_version', 'schema_version', 'design_version'];
  // SurveyAggregate.VALIDATION_CATEGORIES と同一（tests/refresh_diagnostics.test.js が一致を検証する）。
  var DIAG_VALIDATION_CATEGORIES = ['structure', 'snapshot_version', 'version_mismatch', 'generated_at', 'response_status', 'live_count',
    'private_value_detected', 'private_key_detected', 'question_order', 'invalid_state', 'target_count', 'cells_structure',
    'small_cell_suppression', 'complementary_suppression', 'sort_order'];
  var DIAG_MAX_QUESTION_IDS = 40;
  var QUESTION_ID_PATTERN = /^[a-z][a-z0-9_]{0,63}$/;

  function isInt(value) { return typeof value === 'number' && isFinite(value) && value === Math.floor(value); }
  function countOrNull(value) { return isCount(value) ? value : null; }
  function intOrNull(value) { return isInt(value) ? value : null; }
  function pick(list, value) { return typeof value === 'string' && list.indexOf(value) !== -1 ? value : null; }

  /** keys の各キーを件数（非負整数）へ。無い・不正は 0。 */
  function countMap(keys, source) {
    var out = {};
    for (var i = 0; i < keys.length; i++) out[keys[i]] = isPlainObject(source) && isCount(source[keys[i]]) ? source[keys[i]] : 0;
    return out;
  }

  function sanitizeClassify(input) {
    if (!isPlainObject(input)) return null;
    var excluded = countMap(DIAG_EXCLUDED_KEYS, input.excluded);
    var excludedTotal = 0;
    for (var i = 0; i < DIAG_EXCLUDED_KEYS.length; i++) excludedTotal += excluded[DIAG_EXCLUDED_KEYS[i]];
    return {
      rows: countOrNull(input.rows) || 0,
      production_valid: countOrNull(input.production_valid) || 0,
      test_excluded: countOrNull(input.test_excluded) || 0,
      excluded_total: excludedTotal,
      excluded: excluded,
      version_mismatch_fields: countMap(DIAG_VERSION_FIELDS, input.version_mismatch_fields),
      legacy_date_serial_accepted: countOrNull(input.legacy_date_serial_accepted) || 0
    };
  }

  function sanitizeValidate(input) {
    if (!isPlainObject(input)) return null;
    var ids = [];
    if (Array.isArray(input.question_ids)) {
      for (var i = 0; i < input.question_ids.length && ids.length < DIAG_MAX_QUESTION_IDS; i++) {
        var id = input.question_ids[i];
        if (typeof id === 'string' && QUESTION_ID_PATTERN.test(id) && ids.indexOf(id) === -1) ids.push(id);
      }
    }
    return { problem_total: countOrNull(input.problem_total) || 0, categories: countMap(DIAG_VALIDATION_CATEGORIES, input.categories), question_ids: ids };
  }

  /**
   * 診断 → allowlist 済みの診断。result / stage / reason / attempted_at のどれかが不正なら null（保存・表示しない）。
   * 未知のキー・allowlist 外の文字列は捨てる。
   */
  function sanitizeDiagnostics(input) {
    if (!isPlainObject(input)) return null;
    var result = pick(DIAG_RESULTS, input.result);
    var stage = pick(DIAG_STAGES, input.stage);
    var reason = pick(DIAG_REASONS, input.reason);
    var attempted = typeof input.attempted_at === 'string' ? new Date(input.attempted_at) : null;
    if (!result || !stage || !reason || !attempted || isNaN(attempted.getTime())) return null;
    return {
      v: DIAG_VERSION,
      attempted_at: attempted.toISOString(),
      result: result,
      stage: stage,
      reason: reason,
      error_class: pick(DIAG_ERROR_CLASSES, input.error_class),
      previous_exact_total: countOrNull(input.previous_exact_total),
      current_valid_total: countOrNull(input.current_valid_total),
      increment: intOrNull(input.increment),
      classify: sanitizeClassify(input.classify),
      validate: sanitizeValidate(input.validate)
    };
  }

  /** 保存するセル文字列。不正な診断は null。 */
  function encodeDiagnostics(input) {
    var clean = sanitizeDiagnostics(input);
    return clean ? DIAG_PREFIX + JSON.stringify(clean) : null;
  }

  /** セル値 → allowlist 済みの診断 or null（空・形式違い・不正は null）。 */
  function parseDiagnostics(cell) {
    if (typeof cell !== 'string' || cell.indexOf(DIAG_PREFIX) !== 0) return null;
    var parsed;
    try { parsed = JSON.parse(cell.substr(DIAG_PREFIX.length)); } catch (e) { return null; }
    return sanitizeDiagnostics(parsed);
  }

  /** validateSnapshotDetailed の戻り（[{category, question_id}]）→ 件数サマリ。fallbackTotal は詳細が空のときの問題件数。 */
  function summarizeValidation(problems, fallbackTotal) {
    var list = Array.isArray(problems) ? problems : [];
    var categories = {};
    var ids = [];
    for (var i = 0; i < list.length; i++) {
      var category = isPlainObject(list[i]) ? pick(DIAG_VALIDATION_CATEGORIES, list[i].category) : null;
      if (category) categories[category] = (categories[category] || 0) + 1;
      if (isPlainObject(list[i]) && typeof list[i].question_id === 'string') ids.push(list[i].question_id);
    }
    return sanitizeValidate({ problem_total: list.length || fallbackTotal || 0, categories: categories, question_ids: ids });
  }

  /**
   * 例外 → 固定 allowlist の分類（error_class）。message / stack は保存せず、ここで分類コードへ落とすだけ。
   * 完全一致する内部コードか、既知の Apps Script 障害パターンだけを分類する。それ以外は 'unknown'。
   */
  function classifyError(error) {
    var message = error && typeof error.message === 'string' ? error.message : '';
    var name = error && typeof error.name === 'string' ? error.name : '';
    if (message === 'not_configured' || message === 'responses_sheet_missing' || message === 'header_mismatch') return message;
    if (/too many times|quota|rate limit|limit exceeded/i.test(message)) return 'service_quota';
    if (/time(d)? ?out|exceeded maximum execution/i.test(message)) return 'timeout';
    if (/permission|not authorized|authorization|access denied/i.test(message)) return 'permission';
    if (/service (is )?unavailable|temporarily|internal error|server error/i.test(message)) return 'service_unavailable';
    if (/grid limits|outside the dimensions|above the limit|10000000 cells/i.test(message)) return 'sheet_limit';
    if (name === 'TypeError' || name === 'ReferenceError' || name === 'RangeError' || name === 'SyntaxError') return 'programming_error';
    return 'unknown';
  }

  function isPlainObject(value) { return value !== null && typeof value === 'object' && !Array.isArray(value); }
  function isCount(value) { return typeof value === 'number' && isFinite(value) && value >= 0 && value === Math.floor(value); }

  /** meta セル → meta object。形式違い・未知キー・型違いは null。 */
  function parseMeta(cell) {
    if (typeof cell !== 'string' || cell.indexOf(META_PREFIX) !== 0) return null;
    var meta;
    try { meta = JSON.parse(cell.substr(META_PREFIX.length)); } catch (e) { return null; }
    if (!isPlainObject(meta) || meta.v !== STORE_VERSION) return null;
    var allowed = ['v', 'public_total'].concat(STRING_KEYS, COUNT_KEYS);
    var keys = Object.keys(meta);
    for (var i = 0; i < keys.length; i++) if (allowed.indexOf(keys[i]) === -1) return null;
    for (var s = 0; s < STRING_KEYS.length; s++) if (typeof meta[STRING_KEYS[s]] !== 'string') return null;
    for (var c = 0; c < COUNT_KEYS.length; c++) if (!isCount(meta[COUNT_KEYS[c]])) return null;
    // 公開仕様上の回答数。閾値未満の間は snapshot 側が null なので null を許す。
    if (meta.public_total !== null && !isCount(meta.public_total)) return null;
    if (meta.slot >= SLOT_COUNT || meta.chunks < 1 || isNaN(new Date(meta.generated_at).getTime())) return null;
    return meta;
  }

  /** 次に書く slot（現在有効な slot の反対側。meta が無い・不正なら 0）。 */
  function nextSlot(previousMeta) {
    return previousMeta && isCount(previousMeta.slot) ? (previousMeta.slot + 1) % SLOT_COUNT : 0;
  }

  /**
   * 書き込み計画。snapshotJson は JSON.stringify 済みの文字列、digest は SHA-256 hex。
   * info: {generatedAt, exactTotal, publicTotal, reason, updatedAt（ISO）, surveyVersion, schemaVersion, designVersion}
   * 戻り: {slot, chunkCells, metaCell, meta}。呼び出し側は chunkCells を slot の列へ書いた「後に」metaCell を書く。
   */
  function plan(snapshotJson, digest, info, previousMeta) {
    var chunkCells = [];
    for (var offset = 0; offset < snapshotJson.length; offset += CHUNK_SIZE) {
      chunkCells.push(CHUNK_PREFIX + snapshotJson.substr(offset, CHUNK_SIZE));
    }
    var meta = {
      v: STORE_VERSION,
      slot: nextSlot(previousMeta),
      chunks: chunkCells.length,
      length: snapshotJson.length,
      digest: digest,
      generated_at: info.generatedAt,
      exact_total: info.exactTotal,
      public_total: info.publicTotal,
      reason: info.reason,
      updated_at: info.updatedAt,
      survey_version: info.surveyVersion,
      schema_version: info.schemaVersion,
      design_version: info.designVersion
    };
    return { slot: meta.slot, chunkCells: chunkCells, metaCell: META_PREFIX + JSON.stringify(meta), meta: meta };
  }

  /**
   * シート全体の値（行配列。末尾の空セル・空行は省かれていてよい）から、有効な snapshot JSON を取り出す。
   * sha256(text) は呼び出し側が渡す。戻り: {ok:true, meta, json, snapshot} / {ok:false, problem}。
   * problem: empty / meta_invalid / chunk_missing / chunk_invalid / length_mismatch / digest_mismatch / json_invalid
   */
  function readGrid(grid, sha256) {
    var first = Array.isArray(grid) && Array.isArray(grid[0]) ? grid[0][0] : undefined;
    if (first === undefined || first === null || first === '') return { ok: false, problem: 'empty' };
    var meta = parseMeta(first);
    if (!meta) return { ok: false, problem: 'meta_invalid' };
    var parts = [];
    for (var i = 0; i < meta.chunks; i++) {
      var line = grid[i];
      var cell = Array.isArray(line) ? line[1 + meta.slot] : undefined;
      if (cell === undefined || cell === null || cell === '') return { ok: false, problem: 'chunk_missing' };
      if (typeof cell !== 'string' || cell.indexOf(CHUNK_PREFIX) !== 0) return { ok: false, problem: 'chunk_invalid' };
      parts.push(cell.substr(CHUNK_PREFIX.length));
    }
    var json = parts.join('');
    if (json.length !== meta.length) return { ok: false, problem: 'length_mismatch' };
    if (sha256(json) !== meta.digest) return { ok: false, problem: 'digest_mismatch' };
    var snapshot;
    try { snapshot = JSON.parse(json); } catch (e) { return { ok: false, problem: 'json_invalid' }; }
    if (!isPlainObject(snapshot)) return { ok: false, problem: 'json_invalid' };
    return { ok: true, meta: meta, json: json, snapshot: snapshot };
  }

  /** バイト列（Apps Script の Utilities.computeDigest の戻り。符号付き）→ 小文字 hex。 */
  function bytesToHex(bytes) {
    var out = '';
    for (var i = 0; i < bytes.length; i++) {
      var b = bytes[i] < 0 ? bytes[i] + 256 : bytes[i];
      out += (b < 16 ? '0' : '') + b.toString(16);
    }
    return out;
  }

  var api = {
    STORE_VERSION: STORE_VERSION,
    DIAG_PREFIX: DIAG_PREFIX,
    DIAG_COLUMN: DIAG_COLUMN,
    DIAG_STAGES: DIAG_STAGES,
    DIAG_RESULTS: DIAG_RESULTS,
    DIAG_REASONS: DIAG_REASONS,
    DIAG_ERROR_CLASSES: DIAG_ERROR_CLASSES,
    DIAG_VALIDATION_CATEGORIES: DIAG_VALIDATION_CATEGORIES,
    sanitizeDiagnostics: sanitizeDiagnostics,
    summarizeClassification: sanitizeClassify,
    encodeDiagnostics: encodeDiagnostics,
    parseDiagnostics: parseDiagnostics,
    summarizeValidation: summarizeValidation,
    classifyError: classifyError,
    SLOT_COUNT: SLOT_COUNT,
    CHUNK_SIZE: CHUNK_SIZE,
    CHUNK_PREFIX: CHUNK_PREFIX,
    META_PREFIX: META_PREFIX,
    SHEET_NAME: SHEET_NAME,
    parseMeta: parseMeta,
    nextSlot: nextSlot,
    plan: plan,
    readGrid: readGrid,
    bytesToHex: bytesToHex
  };
  return api;
})();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = SnapshotStore;
}


/*
 * 名古屋野球ユニ部アンケート Admin 専用：需要ファネル分析と重要クロス集計（Issue #440）。
 *
 * 設計方針
 *  - ファネルの population / stages / pass / denominator は schema.analysisFunnels を唯一の正本とし、ここへ条件を再定義しない。
 *  - クロス集計の組は schema.adminAnalysis.crossTabs（row / column の設問ID）から読む。集計コードに組を直書きしない。
 *  - 設問の到達（分岐）は core.isVisible で判定する（countQuestionReached と同じ概念）。未到達の回答は分母へ入れない。
 *  - 副作用なし・read-only。Admin 専用で exact を返す（Public の公開閾値・small-cell suppression は適用しない）。
 *  - 返すのは件数・割合・schema 由来の表示ラベルだけ（設問ID・option ID・分析定義IDなどの stable ID は返さない）。respondent_hash / timestamp / test_run_id / source_channel / 行番号 / 自由記述本文は返さない。
 *  - Public GAS / Frontend / maintenance の bundle には含めない（Admin の SurveyGenerated.gs のみ）。
 *
 * ES5記法。Node.js では module.exports でも公開する（tests用）。
 */
var SurveyAnalysis = (function (core, aggregate) {
  'use strict';

  function hasOwn(obj, key) { return Object.prototype.hasOwnProperty.call(obj, key); }
  function isPlainObject(value) { return value !== null && typeof value === 'object' && !Array.isArray(value); }
  function contains(list, item) { return list.indexOf(item) !== -1; }
  function rate(count, base) { return base > 0 ? count / base : null; }

  /* 選択済み option ID（定義済み option のみ）。未回答は空配列。 */
  function pickedIds(question, answers, defIds) {
    return core.selectedIds(question, answers[question.id]).filter(function (id) { return hasOwn(defIds, id); });
  }

  function idSet(defs) {
    var set = {};
    defs.forEach(function (d) { set[d.id] = true; });
    return set;
  }

  function labelsOf(defs, ids) {
    return defs.filter(function (d) { return contains(ids, d.id); }).map(function (d) { return d.label; });
  }

  /* ── 需要ファネル ── */

  /*
   * population を解釈する。
   *  - オブジェクト {設問ID: [optionID,...]}：すべての設問が表示対象で、選択が列挙 option に含まれる回答者。
   *  - 文字列（例 operations_questions_reached）：第1段階の設問に到達した回答者（schema の段階定義から導く）。
   */
  function populationOf(schema, funnel, answersList) {
    var pop = funnel.population;
    var stages = Array.isArray(funnel.stages) ? funnel.stages : [];
    if (isPlainObject(pop)) {
      var keys = Object.keys(pop);
      var members = answersList.filter(function (answers) {
        return keys.every(function (id) {
          var q = core.getQuestion(schema, id);
          if (!q || !core.isVisible(schema, id, answers)) return false;
          return core.selectedIds(q, answers[id]).some(function (v) { return contains(pop[id], v); });
        });
      });
      var definition = keys.map(function (id) {
        var q = core.getQuestion(schema, id);
        return { label: q ? q.label : '', optionLabels: q ? labelsOf(aggregate.cellDefinitions(schema, q), pop[id]) : [] };
      });
      return { members: members, basis: 'answer_in', definition: definition };
    }
    var first = stages.length ? stages[0].question : null;
    var reached = first ? answersList.filter(function (answers) { return core.isVisible(schema, first, answers); }) : [];
    return { members: reached, basis: 'first_stage_reached', definition: first && core.getQuestion(schema, first) ? [{ label: core.getQuestion(schema, first).label, optionLabels: [] }] : [] };
  }

  /* denominator 名の解釈：stage_reached / question_reached / *_population。未知は stage_reached に倒す。 */
  function denominatorMode(name) {
    if (name === 'question_reached') return 'question_reached';
    if (typeof name === 'string' && /_population$/.test(name)) return 'population';
    return 'stage_reached';
  }

  /*
   * 段階の到達者：population のうち、その設問が表示対象で、かつ前の段階の pass を満たした人。
   * pass を持たない段階（role のみ）は内訳段階で、到達者をそのまま次へ引き継ぐ。
   */
  function buildFunnel(schema, id, funnel, answersList, adminAnalysis) {
    var population = populationOf(schema, funnel, answersList);
    var denominator = typeof funnel.denominator === 'string' ? funnel.denominator : 'stage_reached';
    var mode = denominatorMode(denominator);
    var popN = population.members.length;
    var carried = population.members;
    var carriedN = popN;
    var stages = [];
    (Array.isArray(funnel.stages) ? funnel.stages : []).forEach(function (stage) {
      var q = core.getQuestion(schema, stage.question);
      if (!q) return;
      var defs = aggregate.cellDefinitions(schema, q);
      var defIds = idSet(defs);
      var reached = carried.filter(function (answers) { return core.isVisible(schema, q.id, answers); });
      var n = reached.length;
      var base;
      if (mode === 'population') base = popN;
      else if (mode === 'question_reached') base = population.members.filter(function (answers) { return core.isVisible(schema, q.id, answers); }).length;
      else base = n;

      var counts = {};
      defs.forEach(function (d) { counts[d.id] = 0; });
      var answered = 0;
      reached.forEach(function (answers) {
        var ids = pickedIds(q, answers, defIds);
        if (ids.length) answered++;
        ids.forEach(function (v) { counts[v]++; });
      });

      var out = {
        label: q.label,
        type: q.type,
        roleLabel: typeof stage.role === 'string' && adminAnalysis.roleLabels && hasOwn(adminAnalysis.roleLabels, stage.role) ? adminAnalysis.roleLabels[stage.role] : null,
        n: n,
        answeredCount: answered,
        previousN: carriedN,
        rateFromPrevious: rate(n, carriedN),
        denominatorN: base,
        rateOfDenominator: rate(n, base),
        options: defs.map(function (d) { return { label: d.label, count: counts[d.id], rate: rate(counts[d.id], base) }; }),
        pass: null,
        groups: []
      };

      /* experienced / no_experience のような「option ID の配列」を持つ属性は、その group に該当する人数を数える（段階の到達者が分母）。 */
      Object.keys(stage).forEach(function (key) {
        if (key === 'question' || key === 'role' || key === 'pass' || !Array.isArray(stage[key])) return;
        var count = reached.filter(function (answers) {
          return pickedIds(q, answers, defIds).some(function (v) { return contains(stage[key], v); });
        }).length;
        out.groups.push({ optionLabels: labelsOf(defs, stage[key]), count: count, rate: rate(count, n) });
      });

      var next = reached;
      if (Array.isArray(stage.pass)) {
        next = reached.filter(function (answers) {
          return pickedIds(q, answers, defIds).some(function (v) { return contains(stage.pass, v); });
        });
        out.pass = { optionLabels: labelsOf(defs, stage.pass), count: next.length, rate: rate(next.length, n) };
      }
      stages.push(out);
      carried = next;
      carriedN = next.length;
    });

    return {
      label: adminAnalysis.funnelLabels && hasOwn(adminAnalysis.funnelLabels, id) ? adminAnalysis.funnelLabels[id] : id,
      denominator: denominator,
      denominatorLabel: adminAnalysis.denominatorLabels && hasOwn(adminAnalysis.denominatorLabels, denominator) ? adminAnalysis.denominatorLabels[denominator] : null,
      population: { n: popN, basis: population.basis, definition: population.definition },
      stages: stages,
      note: typeof funnel.note === 'string' ? funnel.note : null
    };
  }

  /* 通常の入れ子ファネルではない定義（method だけを持つもの）は「比較」ブロックとして別に返す。 */
  function buildFunnels(schema, answersList) {
    var defs = isPlainObject(schema.analysisFunnels) ? schema.analysisFunnels : {};
    var adminAnalysis = isPlainObject(schema.adminAnalysis) ? schema.adminAnalysis : {};
    var funnels = [];
    var comparisons = [];
    Object.keys(defs).forEach(function (id) {
      var funnel = defs[id];
      if (!isPlainObject(funnel)) return;
      if (Array.isArray(funnel.stages)) funnels.push(buildFunnel(schema, id, funnel, answersList, adminAnalysis));
      else if (typeof funnel.method === 'string') comparisons.push({ method: funnel.method });
    });
    return { funnels: funnels, comparisons: comparisons };
  }

  /* ── クロス集計 ── */

  /*
   * 並び順：publication.ordinal === true は schema 順。名義尺度（publication.sort / adminTallySort が count_desc）は件数降順（同数は schema 順）。
   * Admin「集計結果」カードと同じ規則（adminTally）。
   */
  function isCountDesc(question) {
    var pub = isPlainObject(question.publication) ? question.publication : {};
    if (pub.ordinal === true) return false;
    return pub.sort === 'count_desc' || question.adminTallySort === 'count_desc';
  }

  function orderedIndexes(defs, counts, countDesc) {
    var idx = defs.map(function (d, i) { return i; });
    if (countDesc) {
      idx.sort(function (a, b) {
        var diff = counts[defs[b].id] - counts[defs[a].id];
        return diff !== 0 ? diff : a - b;
      });
    }
    return idx;
  }

  /*
   * 行 × 列。母集団は「行・列の両設問に到達し、両方に回答した」有効回答だけ（分岐未到達・未回答は入れない）。
   * 割合は行カテゴリの到達者数（その行を選んだ人）が分母。multiple 軸は 1 人が複数セルに入る。
   */
  function buildCrossTab(schema, def, answersList) {
    var rowQ = core.getQuestion(schema, def.row);
    var colQ = core.getQuestion(schema, def.column);
    if (!rowQ || !colQ) return null;
    var rowDefs = aggregate.cellDefinitions(schema, rowQ);
    var colDefs = aggregate.cellDefinitions(schema, colQ);
    var rowIds = idSet(rowDefs);
    var colIds = idSet(colDefs);
    var rowN = {};
    var colN = {};
    var cell = {};
    rowDefs.forEach(function (r) { rowN[r.id] = 0; cell[r.id] = {}; colDefs.forEach(function (c) { cell[r.id][c.id] = 0; }); });
    colDefs.forEach(function (c) { colN[c.id] = 0; });

    var reachedBoth = 0;
    var population = 0;
    answersList.forEach(function (answers) {
      if (!core.isVisible(schema, rowQ.id, answers) || !core.isVisible(schema, colQ.id, answers)) return;
      reachedBoth++;
      var rs = pickedIds(rowQ, answers, rowIds);
      var cs = pickedIds(colQ, answers, colIds);
      if (!rs.length || !cs.length) return;
      population++;
      rs.forEach(function (r) { rowN[r]++; cs.forEach(function (c) { cell[r][c]++; }); });
      cs.forEach(function (c) { colN[c]++; });
    });

    var colOrder = orderedIndexes(colDefs, colN, isCountDesc(colQ));
    var rowOrder = orderedIndexes(rowDefs, rowN, isCountDesc(rowQ));
    return {
      label: def.label,
      purpose: typeof def.purpose === 'string' ? def.purpose : null,
      rowAxis: { label: rowQ.label, multiple: rowQ.type === 'multiple' },
      columnAxis: { label: colQ.label, multiple: colQ.type === 'multiple' },
      /* 両設問に到達した人 / そのうち両方に回答した人（= 母集団） */
      reachedCount: reachedBoth,
      population: population,
      unansweredCount: reachedBoth - population,
      /* 母集団全体の列分布（行で絞らない参考値。分母は母集団） */
      overall: colOrder.map(function (i) { var c = colDefs[i]; return { label: c.label, count: colN[c.id], rate: rate(colN[c.id], population) }; }),
      rowCategories: rowOrder.map(function (i) {
        var r = rowDefs[i];
        return {
          label: r.label,
          n: rowN[r.id],
          cells: colOrder.map(function (j) { var c = colDefs[j]; return { label: c.label, count: cell[r.id][c.id], rate: rate(cell[r.id][c.id], rowN[r.id]) }; })
        };
      })
    };
  }

  function buildCrossTabs(schema, answersList) {
    var adminAnalysis = isPlainObject(schema.adminAnalysis) ? schema.adminAnalysis : {};
    var list = Array.isArray(adminAnalysis.crossTabs) ? adminAnalysis.crossTabs : [];
    var out = [];
    list.forEach(function (def) {
      if (!isPlainObject(def)) return;
      var tab = buildCrossTab(schema, def, answersList);
      if (tab) out.push(tab);
    });
    return out;
  }

  /* Admin 専用の分析結果（getAdminAnalysis）。classification は SurveyAggregate.classifyRows の結果（production の有効回答のみ）。 */
  function buildAdminAnalysis(schema, classification) {
    var answersList = classification.valid.map(function (record) { return record.answers; });
    var funnelResult = buildFunnels(schema, answersList);
    return {
      production_valid_total: answersList.length,
      funnels: funnelResult.funnels,
      comparisons: funnelResult.comparisons,
      crossTabs: buildCrossTabs(schema, answersList)
    };
  }

  return {
    buildAdminAnalysis: buildAdminAnalysis,
    buildFunnels: buildFunnels,
    buildCrossTabs: buildCrossTabs,
    buildCrossTab: buildCrossTab,
    denominatorMode: denominatorMode
  };
})(typeof SurveyCore !== 'undefined' ? SurveyCore : require('./survey-core.js'), typeof SurveyAggregate !== 'undefined' ? SurveyAggregate : require('./survey-aggregate.js'));

if (typeof module !== 'undefined' && module.exports) {
  module.exports = SurveyAnalysis;
}
