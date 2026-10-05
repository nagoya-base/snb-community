/*
 * AUTO-GENERATED (Frontend) — DO NOT EDIT.
 * 正本: community/gas/costume_portrait_survey/survey.schema.json と src/survey-core.js
 * 再生成: (community/gas/costume_portrait_survey で) npm run build
 * CIは `npm run build:check` で生成物との差分を検出する。
 */
var SURVEY_SCHEMA = {"schema_version":"3","survey_version":"2026-10","survey_id":"costume_portrait_2026","title":"ユニ・スーツ・衣装で、撮られたい？撮りたい？","subtitle":"男性の衣装・ポートレート意識調査","formalTitle":"男性の衣装・ポートレート撮影に関する意識調査","estimatedMinutes":"約8〜10分","limits":{"otherMaxLength":100,"payloadMaxBytes":100000,"minElapsedMs":20000},"optionSets":{"costume_category":[{"id":"uniform","label":"制服・ユニフォーム"},{"id":"suit","label":"スーツ"},{"id":"workwear","label":"職業制服・作業服"},{"id":"school_uniform","label":"学生服・学校制服"},{"id":"rubber","label":"ラバー"},{"id":"zentai","label":"ゼンタイ（全身タイツ）"},{"id":"leather","label":"レザー"},{"id":"hero_suit","label":"ヒーロースーツ"},{"id":"cosplay","label":"アニメ・ゲーム等のコスプレ"},{"id":"wafuku","label":"和装"},{"id":"crossdress","label":"女装"},{"id":"fundoshi","label":"ふんどし"},{"id":"underwear","label":"下着"},{"id":"nude","label":"ヌード"},{"id":"other","label":"その他","other":true}],"uniform_detail":[{"id":"uniform_baseball","label":"野球"},{"id":"uniform_soccer","label":"サッカー"},{"id":"uniform_rugby","label":"ラグビー"},{"id":"uniform_american_football","label":"アメリカンフットボール"},{"id":"uniform_basketball","label":"バスケットボール"},{"id":"uniform_volleyball","label":"バレーボール"},{"id":"uniform_track","label":"陸上"},{"id":"uniform_swim_briefs","label":"競パン"},{"id":"uniform_judo","label":"柔道"},{"id":"uniform_karate","label":"空手"},{"id":"uniform_kendo","label":"剣道"},{"id":"uniform_singlet","label":"シングレット"},{"id":"other","label":"その他","other":true}],"workwear_detail":[{"id":"workwear_police","label":"警察"},{"id":"workwear_fire","label":"消防"},{"id":"workwear_sdf","label":"自衛隊"},{"id":"workwear_delivery","label":"運送業者"},{"id":"workwear_jumpsuit","label":"ツナギ"},{"id":"security","label":"警備員"},{"id":"railway","label":"鉄道・駅員"},{"id":"aviation","label":"航空・パイロット・空港制服"},{"id":"medical_whitecoat","label":"医療・白衣"},{"id":"factory_workwear","label":"工場・作業着"},{"id":"other","label":"その他","other":true}],"suit_detail":[{"id":"business_suit","label":"ビジネススーツ"},{"id":"young_business","label":"若手会社員・リクルートスーツ風"},{"id":"three_piece","label":"スリーピース"},{"id":"formal_tuxedo","label":"フォーマル・タキシード"},{"id":"shirt_tie","label":"ワイシャツ＋ネクタイ"},{"id":"shirt_slacks","label":"ワイシャツ＋スラックス"},{"id":"vest_style","label":"ベストスタイル"},{"id":"full_coordination","label":"革靴・靴下まで含めた全身コーデ"},{"id":"other","label":"その他","other":true}],"school_uniform_detail":[{"id":"gakuran","label":"学ラン"},{"id":"school_blazer","label":"学校ブレザー"},{"id":"sailor_uniform","label":"セーラー服"},{"id":"gym_uniform","label":"体操服"},{"id":"school_jersey","label":"学校ジャージ"},{"id":"school_swimwear","label":"学校・水泳部系スイムウェア"},{"id":"school_shirt_slacks","label":"ワイシャツ＋スラックスの学生スタイル"},{"id":"other","label":"その他","other":true}]},"sections":[{"id":"interest","title":"興味のある衣装","questions":["costume_interest","uniform_interest","workwear_interest","suit_interest","school_uniform_interest"]},{"id":"wear","title":"着てみたい衣装","description":"「興味がある」と「実際に着たい」は別です。着てみたい衣装を選んでください。","questions":["costume_wear","uniform_wear","workwear_wear","suit_wear","school_uniform_wear"]},{"id":"photographed","title":"撮られてみたい衣装","description":"「着たい」と「撮られたい」は別です。その姿を撮られてみたい衣装を選んでください。","questions":["costume_photographed","uniform_photographed","workwear_photographed","suit_photographed","school_uniform_photographed"]},{"id":"shoot","title":"撮ってみたい衣装","questions":["costume_shoot","uniform_shoot","workwear_shoot","suit_shoot","school_uniform_shoot"]},{"id":"portrait","title":"撮られることについて","questions":["portrait_interest","portrait_styles","fetish_presentation","face_exposure"]},{"id":"usage","title":"写真の利用目的","questions":["photo_usage"]},{"id":"backdrop","title":"背景・世界観","questions":["backdrop"]},{"id":"schedule","title":"撮影時間・曜日・時間帯","questions":["shoot_duration","weekdays","weekday_time_slots","holiday_time_slots"]},{"id":"deliverables","title":"写真枚数・仕上げ","questions":["photo_count","retouch"]},{"id":"hesitation","title":"撮られることへの不安・ためらい","questions":["hesitation"]},{"id":"portrait_price","title":"ポートレート撮影サービスの価格","description":"基準サービス：衣装1種類／実撮影60分／個人撮影／スタジオ利用料込み／レタッチ済み写真10枚程度","questions":["portrait_price"]},{"id":"shooter","title":"人物を撮影することについて","questions":["shooter_interest"]},{"id":"studio","title":"スタジオ利用・撮影機材","showIf":{"question":"shooter_interest","in":["currently_shooting","want_to_try","slightly_interested"]},"questions":["studio_rental","party_size","equipment_wanted","equipment_experience","equipment_support","rental_price"]},{"id":"intent","title":"今後3か月の意向","questions":["intent_3m"]},{"id":"basic","title":"基本情報","description":"ここからは、あなたについて教えてください。氏名・連絡先は聞きません。","questions":["age_range","sexual_orientation","residence","aichi_area","residence_country","travel_range"]},{"id":"free","title":"自由回答・応援メッセージ","questions":["free_ideas","free_themes","cheer_message"]}],"questions":[{"id":"costume_interest","no":"Q5","type":"multi","label":"興味のある衣装を選んでください","required":true,"visibility":"public","optionSet":"costume_category","minSelect":1},{"id":"uniform_interest","no":"Q5-1","type":"multi","label":"興味のある制服・ユニフォーム","required":true,"visibility":"public","optionSet":"uniform_detail","showIf":{"question":"costume_interest","includes":"uniform"}},{"id":"workwear_interest","no":"Q5-2","type":"multi","label":"興味のある職業制服・作業服","required":true,"visibility":"public","optionSet":"workwear_detail","showIf":{"question":"costume_interest","includes":"workwear"}},{"id":"suit_interest","no":"Q5-3","type":"multi","label":"興味のあるスーツ・ビジネススタイル","required":true,"visibility":"public","optionSet":"suit_detail","showIf":{"question":"costume_interest","includes":"suit"}},{"id":"school_uniform_interest","no":"Q5-4","type":"multi","label":"興味のある学生服・学校制服","required":true,"visibility":"public","optionSet":"school_uniform_detail","showIf":{"question":"costume_interest","includes":"school_uniform"}},{"id":"costume_wear","no":"Q6-A","type":"multi","label":"自分が着てみたい衣装を選んでください","required":true,"visibility":"public","optionSet":"costume_category","priorityFrom":"costume_interest"},{"id":"uniform_wear","no":"Q6-A-1","type":"multi","label":"着てみたい制服・ユニフォーム","required":true,"visibility":"private","optionSet":"uniform_detail","showIf":{"question":"costume_wear","includes":"uniform"},"priorityFrom":"uniform_interest"},{"id":"workwear_wear","no":"Q6-A-2","type":"multi","label":"着てみたい職業制服・作業服","required":true,"visibility":"private","optionSet":"workwear_detail","showIf":{"question":"costume_wear","includes":"workwear"},"priorityFrom":"workwear_interest"},{"id":"suit_wear","no":"Q6-A-3","type":"multi","label":"自分が着てみたいスーツ・ビジネススタイル","required":true,"visibility":"private","optionSet":"suit_detail","showIf":{"question":"costume_wear","includes":"suit"},"priorityFrom":"suit_interest"},{"id":"school_uniform_wear","no":"Q6-A-4","type":"multi","label":"自分が着てみたい学生服・学校制服","required":true,"visibility":"private","optionSet":"school_uniform_detail","showIf":{"question":"costume_wear","includes":"school_uniform"},"priorityFrom":"school_uniform_interest"},{"id":"costume_photographed","no":"Q6-B","type":"multi","label":"自分がその姿を撮られてみたい衣装を選んでください","required":true,"visibility":"public","optionSet":"costume_category","priorityFrom":"costume_interest"},{"id":"uniform_photographed","no":"Q6-B-1","type":"multi","label":"撮られてみたい制服・ユニフォーム","required":true,"visibility":"private","optionSet":"uniform_detail","showIf":{"question":"costume_photographed","includes":"uniform"},"priorityFrom":"uniform_interest"},{"id":"workwear_photographed","no":"Q6-B-2","type":"multi","label":"撮られてみたい職業制服・作業服","required":true,"visibility":"private","optionSet":"workwear_detail","showIf":{"question":"costume_photographed","includes":"workwear"},"priorityFrom":"workwear_interest"},{"id":"suit_photographed","no":"Q6-B-3","type":"multi","label":"自分がその姿を撮られてみたいスーツ・ビジネススタイル","required":true,"visibility":"private","optionSet":"suit_detail","showIf":{"question":"costume_photographed","includes":"suit"},"priorityFrom":"suit_interest"},{"id":"school_uniform_photographed","no":"Q6-B-4","type":"multi","label":"自分がその姿を撮られてみたい学生服・学校制服","required":true,"visibility":"private","optionSet":"school_uniform_detail","showIf":{"question":"costume_photographed","includes":"school_uniform"},"priorityFrom":"school_uniform_interest"},{"id":"costume_shoot","no":"Q7","type":"multi","label":"他の人が着ている姿を撮ってみたい衣装を選んでください","required":true,"visibility":"public","optionSet":"costume_category","priorityFrom":"costume_interest"},{"id":"uniform_shoot","no":"Q7-1","type":"multi","label":"撮ってみたい制服・ユニフォーム","required":true,"visibility":"private","optionSet":"uniform_detail","showIf":{"question":"costume_shoot","includes":"uniform"},"priorityFrom":"uniform_interest"},{"id":"workwear_shoot","no":"Q7-2","type":"multi","label":"撮ってみたい職業制服・作業服","required":true,"visibility":"private","optionSet":"workwear_detail","showIf":{"question":"costume_shoot","includes":"workwear"},"priorityFrom":"workwear_interest"},{"id":"suit_shoot","no":"Q7-3","type":"multi","label":"他の人が着ている姿を撮ってみたいスーツ・ビジネススタイル","required":true,"visibility":"private","optionSet":"suit_detail","showIf":{"question":"costume_shoot","includes":"suit"},"priorityFrom":"suit_interest"},{"id":"school_uniform_shoot","no":"Q7-4","type":"multi","label":"他の人が着ている姿を撮ってみたい学生服・学校制服","required":true,"visibility":"private","optionSet":"school_uniform_detail","showIf":{"question":"costume_shoot","includes":"school_uniform"},"priorityFrom":"school_uniform_interest"},{"id":"portrait_interest","no":"Q8","type":"single","label":"自分自身のポートレートを撮影してもらうことに興味がありますか？","required":true,"visibility":"public","options":[{"id":"very_interested","label":"とても興味がある"},{"id":"interested","label":"やや興味がある"},{"id":"neutral","label":"どちらともいえない"},{"id":"not_much","label":"あまり興味がない"},{"id":"not_at_all","label":"まったく興味がない"},{"id":"other","label":"その他","other":true}]},{"id":"portrait_styles","no":"Q9","type":"multi","label":"どのような写真を撮られてみたいですか？","required":true,"visibility":"public","options":[{"id":"natural_profile","label":"自然なプロフィール写真"},{"id":"cool_portrait","label":"カッコいいポートレート"},{"id":"athlete_style","label":"スポーツ選手風"},{"id":"club_youth","label":"部活・青春っぽい写真"},{"id":"fashion","label":"ファッション写真"},{"id":"cinematic","label":"映画・ドラマ風"},{"id":"dark_decadent","label":"ダーク・退廃的"},{"id":"cyber_futuristic","label":"サイバー・近未来"},{"id":"japanese_style","label":"和風"},{"id":"fetish","label":"フェティッシュ"},{"id":"sexy","label":"セクシー"},{"id":"physique","label":"肉体・身体表現"},{"id":"cosplay_work","label":"コスプレ作品"},{"id":"other","label":"その他","other":true}]},{"id":"fetish_presentation","no":"Q9-A","type":"multi","label":"どのような見せ方・シチュエーションに惹かれますか？","help":"撮影表現として惹かれるものを、いくつでも選んでください。","required":true,"visibility":"private","options":[{"id":"sweaty_post_workout","label":"汗・運動後っぽい雰囲気"},{"id":"mid_change","label":"着替え途中"},{"id":"shoes_feet","label":"靴・足元を重視"},{"id":"socks","label":"ソックスを重視"},{"id":"back_view","label":"後ろ姿を重視"},{"id":"body_detail","label":"身体の一部を強調"},{"id":"uniform_dressed_down","label":"ユニフォームを着崩した姿"},{"id":"suit_dressed_down","label":"ネクタイを緩めるなど、スーツを着崩した姿"},{"id":"clothing_detail","label":"衣装・素材・ディテールのアップ"},{"id":"clean_formal","label":"きっちり着こなした姿"},{"id":"no_preference","label":"特にこだわらない","exclusive":true},{"id":"other","label":"その他","other":true}]},{"id":"face_exposure","no":"Q10","type":"single","label":"顔の写り方について希望するものを選んでください","required":true,"visibility":"public","options":[{"id":"full_face","label":"顔をしっかり写したい"},{"id":"partial_face","label":"一部なら写ってもよい"},{"id":"ok_if_not_public","label":"SNSなどに公開しない前提なら、顔が写ってもよい"},{"id":"hidden_face","label":"顔を隠して撮影したい"},{"id":"back_body_focus","label":"後ろ姿・身体中心がよい"},{"id":"depends","label":"内容による"},{"id":"no_preference","label":"特にこだわらない"},{"id":"other","label":"その他","other":true}]},{"id":"photo_usage","no":"Q11","type":"multi","label":"撮影した写真を何に使いたいですか？","required":true,"visibility":"public","options":[{"id":"view_save_only","label":"自分だけで見る・保存する"},{"id":"memory","label":"思い出として残す"},{"id":"post_x","label":"Xに投稿する"},{"id":"post_instagram","label":"Instagramに投稿する"},{"id":"post_other_sns","label":"その他SNSに投稿する"},{"id":"sns_icon","label":"SNSのアイコンにする"},{"id":"dating_profile","label":"マッチングアプリ・プロフィールに使う"},{"id":"show_friends","label":"友人・知人に見せる"},{"id":"publish_as_work","label":"創作・作品として公開する"},{"id":"promo_photo","label":"宣材写真として使う"},{"id":"event_profile","label":"イベント・活動のプロフィールに使う"},{"id":"website","label":"Webサイトに使う"},{"id":"photobook","label":"写真集・フォトブックを作る"},{"id":"fansite_monetize","label":"ファンサイト等に投稿し、収益を得る"},{"id":"enjoy_shooting_itself","label":"特に用途を決めず撮影自体を楽しみたい"},{"id":"other","label":"その他","other":true}]},{"id":"backdrop","no":"Q17","type":"multi","label":"使ってみたい背景・セットを選んでください","required":true,"visibility":"public","options":[{"id":"white","label":"白背景"},{"id":"black","label":"黒背景"},{"id":"gray","label":"グレー・無彩色"},{"id":"school_classroom","label":"学校・教室"},{"id":"japanese_room","label":"和室・畳"},{"id":"japanese_style","label":"和風"},{"id":"cyber_futuristic","label":"サイバー・近未来"},{"id":"dark","label":"ダーク"},{"id":"ruins_grunge","label":"廃墟・グランジ"},{"id":"fantasy","label":"異世界・ファンタジー"},{"id":"simple_interior","label":"シンプルな室内"},{"id":"natural_light","label":"自然光風"},{"id":"other","label":"その他","other":true}]},{"id":"shoot_duration","no":"Q12","type":"single","label":"1回の撮影で希望する実撮影時間","required":true,"visibility":"public","options":[{"id":"min_30","label":"30分"},{"id":"min_45","label":"45分"},{"id":"min_60","label":"60分"},{"id":"min_90","label":"90分"},{"id":"min_120","label":"120分"},{"id":"over_2h","label":"2時間以上"},{"id":"depends","label":"内容による"},{"id":"other","label":"その他","other":true}],"help":"「実撮影時間」は、カメラの前で撮影している時間です。着替え・準備・撤収を含む滞在時間とは別です。"},{"id":"weekdays","no":"Q13","type":"multi","label":"利用しやすい曜日","required":true,"visibility":"public","options":[{"id":"weekday","label":"平日"},{"id":"saturday","label":"土曜日"},{"id":"sunday","label":"日曜日"},{"id":"holiday","label":"祝日"},{"id":"no_preference","label":"特に決まっていない","exclusive":true},{"id":"other","label":"その他","other":true}],"help":"利用しやすい日の区分を、当てはまるものすべて選んでください。選んだ区分に応じて、次に時間帯をお聞きします。"},{"id":"weekday_time_slots","no":"Q14-1","type":"multi","label":"平日に利用しやすい時間帯","required":true,"visibility":"public","showIf":{"question":"weekdays","includes":"weekday"},"options":[{"id":"t09_12","label":"9:00〜12:00"},{"id":"t13_16","label":"13:00〜16:00"},{"id":"t14_17","label":"14:00〜17:00"},{"id":"t15_18","label":"15:00〜18:00"},{"id":"t18_21","label":"18:00〜21:00"},{"id":"t19_22","label":"19:00〜22:00"},{"id":"t20_23","label":"20:00〜23:00"},{"id":"no_preference","label":"特に決まっていない","exclusive":true},{"id":"other","label":"その他","other":true}],"help":"12:00〜13:00のお昼時を避けたい場合などの目安に、当てはまるものをすべて選んでください。"},{"id":"holiday_time_slots","no":"Q14-2","type":"multi","label":"土日祝に利用しやすい時間帯","required":true,"visibility":"public","showIf":{"question":"weekdays","in":["saturday","sunday","holiday"]},"options":[{"id":"t09_12","label":"9:00〜12:00"},{"id":"t13_16","label":"13:00〜16:00"},{"id":"t14_17","label":"14:00〜17:00"},{"id":"t15_18","label":"15:00〜18:00"},{"id":"t18_21","label":"18:00〜21:00"},{"id":"t19_22","label":"19:00〜22:00"},{"id":"t20_23","label":"20:00〜23:00"},{"id":"no_preference","label":"特に決まっていない","exclusive":true},{"id":"other","label":"その他","other":true}],"help":"平日の時間帯とは別にお聞きします。当てはまるものをすべて選んでください。"},{"id":"photo_count","no":"Q15","type":"single","label":"1回の撮影でもらいたい写真枚数","required":true,"visibility":"public","options":[{"id":"p5","label":"5枚程度を厳選"},{"id":"p10","label":"10枚程度"},{"id":"p20","label":"20枚程度"},{"id":"p30","label":"30枚程度"},{"id":"p50","label":"50枚程度"},{"id":"almost_all","label":"撮影した写真をほぼ全部"},{"id":"quality_over_count","label":"枚数より仕上がりを重視"},{"id":"other","label":"その他","other":true}]},{"id":"retouch","no":"Q16","type":"single","label":"写真の仕上げについて希望するもの","required":true,"visibility":"public","options":[{"id":"few_retouched","label":"しっかりレタッチした写真を少数"},{"id":"many_adjusted","label":"明るさ・色等を調整した写真を多数"},{"id":"both","label":"「しっかりレタッチした写真（少数）」と「明るさ・色等を調整した写真（多数）」の両方ほしい"},{"id":"none","label":"レタッチ不要"},{"id":"unsure","label":"よく分からない"},{"id":"other","label":"その他","other":true}],"help":"「両方」は、しっかりレタッチした少数の写真と、明るさ・色等を調整した多数の写真の両方を指します。"},{"id":"hesitation","no":"Q16-A","type":"multi","label":"撮影してもらうことに興味はあっても、ためらう理由はありますか？","required":true,"visibility":"private","options":[{"id":"face_exposure_worry","label":"顔出しが不安"},{"id":"not_photogenic","label":"写真写りに自信がない"},{"id":"dont_know_poses","label":"ポーズが分からない"},{"id":"nervous_alone_with_photographer","label":"カメラマンと2人になるのが緊張する"},{"id":"body_confidence","label":"体型に自信がない"},{"id":"no_costume","label":"衣装を持っていない"},{"id":"price_concern","label":"料金が気になる"},{"id":"dont_want_public","label":"写真をSNS等で公開されたくない"},{"id":"unsure_use","label":"撮った写真の使い道が分からない"},{"id":"none","label":"特にない","exclusive":true},{"id":"other","label":"その他","other":true}]},{"id":"portrait_price","no":"Q18","type":"single","label":"上記内容の場合、利用を検討する価格帯","required":true,"visibility":"private","options":[{"id":"under_3000","label":"3,000円未満"},{"id":"3000_4999","label":"3,000～4,999円"},{"id":"5000_6999","label":"5,000～6,999円"},{"id":"7000_8999","label":"7,000～8,999円"},{"id":"9000_11999","label":"9,000～11,999円"},{"id":"12000_14999","label":"12,000～14,999円"},{"id":"15000_plus","label":"15,000円以上"},{"id":"not_use","label":"この内容では利用しない"},{"id":"other","label":"その他","other":true}]},{"id":"shooter_interest","no":"Q20","type":"single","label":"自分で人物を撮影することに興味がありますか？","required":true,"visibility":"private","options":[{"id":"currently_shooting","label":"現在撮影している"},{"id":"want_to_try","label":"やってみたい"},{"id":"slightly_interested","label":"少し興味がある"},{"id":"subject_only","label":"撮影される側だけ興味がある"},{"id":"not_interested","label":"興味はない"},{"id":"other","label":"その他","other":true}]},{"id":"studio_rental","no":"Q21","type":"single","label":"個人撮影のために撮影スタジオを借りたいと思いますか？","required":true,"visibility":"private","options":[{"id":"already_using","label":"すでに利用している"},{"id":"want_to_try","label":"借りてみたい"},{"id":"if_conditions_fit","label":"条件が合えば借りたい"},{"id":"not_really","label":"あまり思わない"},{"id":"wont_rent","label":"借りるつもりはない"},{"id":"other","label":"その他","other":true}],"showIf":{"question":"shooter_interest","in":["currently_shooting","want_to_try","slightly_interested"]}},{"id":"party_size","no":"Q22","type":"single","label":"何人くらいで利用したいですか？","required":true,"visibility":"private","options":[{"id":"one","label":"1人"},{"id":"two","label":"モデル＋撮影者の2人"},{"id":"three","label":"3人"},{"id":"four","label":"4人"},{"id":"five_plus","label":"5人以上"},{"id":"other","label":"その他","other":true}],"showIf":{"question":"shooter_interest","in":["currently_shooting","want_to_try","slightly_interested"]}},{"id":"equipment_wanted","no":"Q23","type":"multi","label":"スタジオにあったら使ってみたい機材","required":true,"visibility":"private","options":[{"id":"monoblock_strobe","label":"モノブロックストロボ"},{"id":"clip_on_strobe","label":"クリップオンストロボ"},{"id":"led_video_light","label":"LEDビデオライト（白色）"},{"id":"rgb_light","label":"RGBカラーライト"},{"id":"softbox","label":"ソフトボックス"},{"id":"umbrella","label":"アンブレラ"},{"id":"reflector","label":"レフ板"},{"id":"backdrop_paper","label":"背景紙"},{"id":"light_stand","label":"ライトスタンド"},{"id":"tripod","label":"三脚"},{"id":"wireless_trigger","label":"ワイヤレスストロボトリガー"},{"id":"dont_know","label":"よく分からない","exclusive":true},{"id":"other","label":"その他","other":true}],"showIf":{"question":"shooter_interest","in":["currently_shooting","want_to_try","slightly_interested"]}},{"id":"equipment_experience","no":"Q24","type":"single","label":"ストロボや照明機材を自分で使えますか？","required":true,"visibility":"private","options":[{"id":"fluent","label":"問題なく使える"},{"id":"basic","label":"基本的な操作ならできる"},{"id":"tried_a_little","label":"少し触ったことがある"},{"id":"almost_cannot","label":"ほぼ使えない"},{"id":"none","label":"まったく分からない"},{"id":"other","label":"その他","other":true}],"showIf":{"question":"shooter_interest","in":["currently_shooting","want_to_try","slightly_interested"]}},{"id":"equipment_support","no":"Q25","type":"multi","label":"機材について、どのようなサービスがあれば利用しやすいですか？","required":true,"visibility":"private","options":[{"id":"gear_only","label":"機材だけ貸してほしい"},{"id":"brief_explanation","label":"簡単な使い方説明がほしい"},{"id":"initial_setup","label":"最初だけセッティングしてほしい"},{"id":"consult_during","label":"撮影中も相談したい"},{"id":"camera_settings","label":"カメラ設定まで教えてほしい"},{"id":"lighting_lessons","label":"照明の使い方を教わりたい"},{"id":"no_support","label":"特にサポートは必要ない","exclusive":true},{"id":"other","label":"その他","other":true}],"showIf":{"question":"shooter_interest","in":["currently_shooting","want_to_try","slightly_interested"]}},{"id":"rental_price","no":"Q26","type":"single","label":"モデル1名＋撮影者1名で、照明機材が利用できる個室スタジオを2時間借りる場合、利用を検討する価格","required":true,"visibility":"private","options":[{"id":"under_2000","label":"2,000円未満"},{"id":"2000_2999","label":"2,000～2,999円"},{"id":"3000_3999","label":"3,000～3,999円"},{"id":"4000_4999","label":"4,000～4,999円"},{"id":"5000_5999","label":"5,000～5,999円"},{"id":"6000_7999","label":"6,000～7,999円"},{"id":"8000_plus","label":"8,000円以上"},{"id":"not_use","label":"利用しない"},{"id":"other","label":"その他","other":true}],"showIf":{"question":"shooter_interest","in":["currently_shooting","want_to_try","slightly_interested"]},"help":"ポートレート撮影サービス（Q18）の価格とは別の質問です。"},{"id":"intent_3m","no":"Q27","type":"matrix","label":"今後3か月以内に、次のことをしてみたいと思いますか？","required":true,"visibility":"private","rows":[{"id":"get_portrait","label":"衣装ポートレートを撮ってもらう"},{"id":"shoot_model","label":"自分でモデルを撮影する"},{"id":"rent_studio","label":"撮影スタジオを借りる"},{"id":"join_shoot_event","label":"撮影イベントに参加する"},{"id":"join_small_session","label":"少人数撮影会に参加する"},{"id":"try_lighting","label":"照明機材を使ってみる"},{"id":"learn_shooting","label":"撮影方法を教わる"},{"id":"meet_people","label":"同じ衣装・撮影趣味の人と交流する"}],"scale":[{"id":"definitely","label":"ぜひやりたい"},{"id":"if_conditions_fit","label":"条件が合えばやりたい"},{"id":"interested","label":"興味はある"},{"id":"not_thinking","label":"あまり考えていない"},{"id":"no","label":"しない"}]},{"id":"age_range","no":"Q1","type":"single","label":"年齢","required":true,"visibility":"public","options":[{"id":"age_18_19","label":"18～19歳"},{"id":"age_20_24","label":"20～24歳"},{"id":"age_25_29","label":"25～29歳"},{"id":"age_30_34","label":"30～34歳"},{"id":"age_35_39","label":"35～39歳"},{"id":"age_40_49","label":"40～49歳"},{"id":"age_50_59","label":"50～59歳"},{"id":"age_60_plus","label":"60歳以上"},{"id":"prefer_not","label":"回答しない"},{"id":"other","label":"その他","other":true}]},{"id":"sexual_orientation","no":"Q2","type":"single","label":"性的指向（任意）","required":false,"visibility":"private","options":[{"id":"gay","label":"ゲイ"},{"id":"bisexual","label":"バイセクシュアル"},{"id":"undecided","label":"特に決めていない"},{"id":"prefer_not","label":"回答しない"},{"id":"other","label":"その他","other":true}]},{"id":"residence","no":"Q3","type":"single","label":"居住地域","required":true,"visibility":"private","options":[{"id":"pref_01","label":"北海道"},{"id":"pref_02","label":"青森県"},{"id":"pref_03","label":"岩手県"},{"id":"pref_04","label":"宮城県"},{"id":"pref_05","label":"秋田県"},{"id":"pref_06","label":"山形県"},{"id":"pref_07","label":"福島県"},{"id":"pref_08","label":"茨城県"},{"id":"pref_09","label":"栃木県"},{"id":"pref_10","label":"群馬県"},{"id":"pref_11","label":"埼玉県"},{"id":"pref_12","label":"千葉県"},{"id":"pref_13","label":"東京都"},{"id":"pref_14","label":"神奈川県"},{"id":"pref_15","label":"新潟県"},{"id":"pref_16","label":"富山県"},{"id":"pref_17","label":"石川県"},{"id":"pref_18","label":"福井県"},{"id":"pref_19","label":"山梨県"},{"id":"pref_20","label":"長野県"},{"id":"pref_21","label":"岐阜県"},{"id":"pref_22","label":"静岡県"},{"id":"pref_23","label":"愛知県"},{"id":"pref_24","label":"三重県"},{"id":"pref_25","label":"滋賀県"},{"id":"pref_26","label":"京都府"},{"id":"pref_27","label":"大阪府"},{"id":"pref_28","label":"兵庫県"},{"id":"pref_29","label":"奈良県"},{"id":"pref_30","label":"和歌山県"},{"id":"pref_31","label":"鳥取県"},{"id":"pref_32","label":"島根県"},{"id":"pref_33","label":"岡山県"},{"id":"pref_34","label":"広島県"},{"id":"pref_35","label":"山口県"},{"id":"pref_36","label":"徳島県"},{"id":"pref_37","label":"香川県"},{"id":"pref_38","label":"愛媛県"},{"id":"pref_39","label":"高知県"},{"id":"pref_40","label":"福岡県"},{"id":"pref_41","label":"佐賀県"},{"id":"pref_42","label":"長崎県"},{"id":"pref_43","label":"熊本県"},{"id":"pref_44","label":"大分県"},{"id":"pref_45","label":"宮崎県"},{"id":"pref_46","label":"鹿児島県"},{"id":"pref_47","label":"沖縄県"},{"id":"overseas","label":"海外"},{"id":"other","label":"その他","other":true}]},{"id":"aichi_area","no":"Q3-1","type":"single","label":"愛知県のどの地域にお住まいですか？","required":true,"visibility":"private","showIf":{"question":"residence","includes":"pref_23"},"options":[{"id":"nagoya_city","label":"名古屋市内"},{"id":"owari","label":"尾張地区"},{"id":"mikawa","label":"三河地区"},{"id":"unknown_other","label":"その他 / わからない"}],"help":"集客エリアの把握のための区分で、行政区分の厳密さは問いません。"},{"id":"residence_country","no":"Q3-2","type":"text","label":"お住まいの国名を入力してください","required":true,"visibility":"private","showIf":{"question":"residence","includes":"overseas"},"maxLength":50,"multiline":false},{"id":"travel_range","no":"Q4","type":"single","label":"撮影やスタジオ利用のためなら、どの程度まで移動できますか？","required":true,"visibility":"private","options":[{"id":"within_city","label":"市内程度"},{"id":"within_prefecture","label":"県内程度"},{"id":"tokai_3_prefectures","label":"東海3県程度"},{"id":"one_hour","label":"片道1時間程度"},{"id":"two_hours","label":"片道2時間程度"},{"id":"shinkansen_trip","label":"新幹線等を使った遠征も可能"},{"id":"depends_on_content","label":"距離より内容次第"},{"id":"other","label":"その他","other":true}]},{"id":"free_ideas","no":"Q28","type":"text","label":"「こんな撮影なら参加したい」「こんなスタジオなら使いたい」というものがあれば教えてください","required":false,"visibility":"private","maxLength":1000},{"id":"free_themes","no":"Q29","type":"text","label":"今後、服装・フェチ・スポーツ・撮影などについて、調べてほしいテーマがあれば教えてください","required":false,"visibility":"private","maxLength":1000,"help":"衣装・服装・フェチ・スポーツ・撮影スタイルなど、自由にお書きください。"},{"id":"cheer_message","no":"Q30","type":"text","label":"最後に、運営への応援・激励メッセージがあればお願いします","required":false,"visibility":"private","maxLength":1000,"help":"アンケート、撮影企画、スタジオ運営について、応援や励ましのメッセージがあれば自由にお書きください。特になければ空欄のままで構いません。"}],"funnels":{"portrait_interest":{"label":"ポートレート撮影に興味あり","question":"portrait_interest","include":["very_interested","interested"]},"wants_photographed":{"label":"撮られたい衣装を選択","all":["portrait_interest",{"question":"costume_photographed","nonEmpty":true}]},"near_term_intent":{"label":"3か月以内に撮ってもらいたい","question":"intent_3m","row":"get_portrait","include":["definitely","if_conditions_fit"]},"price_7000_plus":{"label":"7,000円以上の価格帯を許容","question":"portrait_price","include":["7000_8999","9000_11999","12000_14999","15000_plus"]},"shooter_interest":{"label":"自分で人物を撮影したい","question":"shooter_interest","include":["currently_shooting","want_to_try","slightly_interested"]},"studio_wanted":{"label":"スタジオを借りたい","question":"studio_rental","include":["already_using","want_to_try","if_conditions_fit"]},"strobe_wanted":{"label":"ストロボを使いたい","question":"equipment_wanted","anyOf":["monoblock_strobe","clip_on_strobe"]},"cannot_operate":{"label":"機材は自分では扱えない","question":"equipment_experience","include":["almost_cannot","none"]},"supported_ok":{"label":"説明・サポート付きなら利用したい","question":"equipment_support","anyOf":["brief_explanation","initial_setup","consult_during","camera_settings","lighting_lessons"]}},"funnelFlows":{"portrait_demand":{"label":"ポートレート撮影の需要ファネル","stages":["portrait_interest","wants_photographed","near_term_intent","price_7000_plus"]},"shooter_demand":{"label":"撮影者・スタジオ・機材の需要ファネル","stages":["shooter_interest","studio_wanted","strobe_wanted","cannot_operate","supported_ok"]}},"crosstabs":[{"id":"age_x_costume","label":"年代 × 興味のある衣装","row":{"question":"age_range"},"col":{"question":"costume_interest"}},{"id":"age_x_portrait_interest","label":"年代 × 撮られたい意向","row":{"question":"age_range"},"col":{"question":"portrait_interest"}},{"id":"costume_x_photographed","label":"興味のある衣装 × 撮られたい衣装","row":{"question":"costume_interest"},"col":{"question":"costume_photographed"}},{"id":"costume_x_shoot","label":"興味のある衣装 × 撮りたい衣装","row":{"question":"costume_interest"},"col":{"question":"costume_shoot"}},{"id":"costume_x_backdrop","label":"興味のある衣装 × 背景","row":{"question":"costume_interest"},"col":{"question":"backdrop"}},{"id":"interest_x_price","label":"撮られたい意向 × 希望価格","row":{"question":"portrait_interest"},"col":{"question":"portrait_price"}},{"id":"interest_x_weekday","label":"撮られたい意向 × 曜日","row":{"question":"portrait_interest"},"col":{"question":"weekdays"}},{"id":"interest_x_weekday_time","label":"撮られたい意向 × 平日の時間帯","row":{"question":"portrait_interest"},"col":{"question":"weekday_time_slots"}},{"id":"interest_x_holiday_time","label":"撮られたい意向 × 土日祝の時間帯","row":{"question":"portrait_interest"},"col":{"question":"holiday_time_slots"}},{"id":"usage_x_interest","label":"写真用途 × 撮影意向","row":{"question":"photo_usage"},"col":{"question":"portrait_interest"}},{"id":"shooter_x_studio","label":"撮影者意向 × スタジオ利用意向","row":{"question":"shooter_interest"},"col":{"question":"studio_rental"}},{"id":"studio_x_rental_price","label":"スタジオ利用意向 × レンタル価格","row":{"question":"studio_rental"},"col":{"question":"rental_price"}},{"id":"experience_x_support","label":"機材経験 × サポート需要","row":{"question":"equipment_experience"},"col":{"question":"equipment_support"}},{"id":"intent3m_x_price","label":"3か月以内利用意向（撮ってもらう） × 価格帯","row":{"question":"intent_3m","row":"get_portrait"},"col":{"question":"portrait_price"}},{"id":"interest_x_suit_photographed","label":"撮られたい意向 × 撮られてみたいスーツ・ビジネススタイル","row":{"question":"portrait_interest"},"col":{"question":"suit_photographed"}},{"id":"interest_x_school_photographed","label":"撮られたい意向 × 撮られてみたい学生服・学校制服","row":{"question":"portrait_interest"},"col":{"question":"school_uniform_photographed"}},{"id":"interest_x_fetish_presentation","label":"撮られたい意向 × 見せ方・シチュエーション","row":{"question":"portrait_interest"},"col":{"question":"fetish_presentation"}}],"publicResults":{"minTotal":30,"minCell":3,"ageGroups":[{"id":"age_18_29","label":"18〜29歳","members":["age_18_19","age_20_24","age_25_29"]},{"id":"age_30_39","label":"30〜39歳","members":["age_30_34","age_35_39"]},{"id":"age_40_49","label":"40〜49歳","members":["age_40_49"]},{"id":"age_50_plus","label":"50歳以上","members":["age_50_59","age_60_plus"]},{"id":"age_unspecified","label":"回答しない・その他","members":["prefer_not","other"]}],"items":[{"id":"age_range","question":"age_range","title":"年代","groupBy":"ageGroups"},{"id":"costume_interest","question":"costume_interest","title":"興味のある衣装"},{"id":"uniform_interest","question":"uniform_interest","title":"興味のある制服・ユニフォーム"},{"id":"workwear_interest","question":"workwear_interest","title":"興味のある職業制服・作業服"},{"id":"suit_interest","question":"suit_interest","title":"興味のあるスーツ・ビジネススタイル"},{"id":"school_uniform_interest","question":"school_uniform_interest","title":"興味のある学生服・学校制服"},{"id":"costume_wear","question":"costume_wear","title":"着てみたい衣装"},{"id":"costume_photographed","question":"costume_photographed","title":"撮られてみたい衣装"},{"id":"costume_shoot","question":"costume_shoot","title":"撮ってみたい衣装"},{"id":"portrait_interest","question":"portrait_interest","title":"ポートレート撮影への興味"},{"id":"portrait_styles","question":"portrait_styles","title":"撮られてみたい写真"},{"id":"photo_usage","question":"photo_usage","title":"写真の利用目的"},{"id":"face_exposure","question":"face_exposure","title":"顔の写り方の希望"},{"id":"shoot_duration","question":"shoot_duration","title":"希望する実撮影時間"},{"id":"weekdays","question":"weekdays","title":"利用しやすい曜日"},{"id":"weekday_time_slots","question":"weekday_time_slots","title":"平日に利用しやすい時間帯"},{"id":"holiday_time_slots","question":"holiday_time_slots","title":"土日祝に利用しやすい時間帯"},{"id":"photo_count","question":"photo_count","title":"希望する写真枚数"},{"id":"retouch","question":"retouch","title":"写真の仕上げ"},{"id":"backdrop","question":"backdrop","title":"人気の背景・セット"}]}};

/*
 * 男性の衣装・ポートレート意識調査：schema駆動の共通エンジン（正本）。
 *
 * このファイルは tools/build-survey.js により SURVEY_SCHEMA（survey.schema.json）と結合され、
 * Frontend / Public GAS / Admin GAS に同一内容で生成される。生成物を直接編集しないこと。
 * 設問・選択肢・分岐・ファネルをここにベタ書きしない（すべてschemaから読む）。
 * ES5記法で書き、ブラウザ・Apps Script V8・Node.jsのいずれでも動く。
 */
var SurveyCore = (function () {
  'use strict';

  var CONTROL_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/;
  var cache = { schema: null, index: null };

  function hasOwn(obj, key) { return Object.prototype.hasOwnProperty.call(obj, key); }
  function isPlainObject(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
  }

  function getOptions(schema, question) {
    if (question.options) return question.options;
    if (question.optionSet) return schema.optionSets[question.optionSet] || [];
    return [];
  }

  function buildIndex(schema) {
    if (cache.schema === schema) return cache.index;
    var byId = {};
    var order = [];
    var sectionOf = {};
    var sectionById = {};
    schema.sections.forEach(function (section) {
      sectionById[section.id] = section;
      section.questions.forEach(function (id) { sectionOf[id] = section.id; });
    });
    schema.questions.forEach(function (question) {
      byId[question.id] = question;
      order.push(question.id);
    });
    cache = { schema: schema, index: { byId: byId, order: order, sectionOf: sectionOf, sectionById: sectionById } };
    return cache.index;
  }

  function getQuestion(schema, id) {
    var byId = buildIndex(schema).byId;
    return typeof id === 'string' && hasOwn(byId, id) ? byId[id] : null;
  }

  function charLength(text) { return Array.from(String(text)).length; }
  function normalizeText(text) { return String(text).replace(/\r\n?/g, '\n').trim(); }

  function encodeMulti(values) {
    return values && values.length ? '|' + values.join('|') + '|' : '';
  }
  function decodeMulti(text) {
    if (typeof text !== 'string' || !text) return [];
    return text.split('|').filter(function (part) { return part !== ''; });
  }

  /* 選択済みIDの配列（single/multi。不正な型は空として扱う） */
  function selectedIds(question, value) {
    if (question.type === 'single') return typeof value === 'string' && value ? [value] : [];
    if (question.type === 'multi') {
      return Array.isArray(value) ? value.filter(function (v) { return typeof v === 'string'; }) : [];
    }
    return [];
  }

  function evalCondition(schema, condition, answers) {
    if (!condition) return true;
    var question = getQuestion(schema, condition.question);
    if (!question) return false;
    var selected = selectedIds(question, answers[condition.question]);
    if (condition.includes !== undefined) return selected.indexOf(condition.includes) !== -1;
    if (condition['in']) {
      return selected.some(function (id) { return condition['in'].indexOf(id) !== -1; });
    }
    return false;
  }

  function isSectionVisible(schema, sectionId, answers) {
    var sections = buildIndex(schema).sectionById;
    var section = typeof sectionId === 'string' && hasOwn(sections, sectionId) ? sections[sectionId] : null;
    return !!section && evalCondition(schema, section.showIf, answers);
  }

  /* 親設問が非表示なら子も非表示（再帰）。sectionのshowIfも考慮する。 */
  function isVisible(schema, questionId, answers, depth) {
    var idx = buildIndex(schema);
    var question = idx.byId[questionId];
    if (!question) return false;
    if ((depth || 0) > 10) return false;
    var sectionId = idx.sectionOf[questionId];
    if (sectionId && !isSectionVisible(schema, sectionId, answers)) return false;
    if (!question.showIf) return true;
    if (!isVisible(schema, question.showIf.question, answers, (depth || 0) + 1)) return false;
    return evalCondition(schema, question.showIf, answers);
  }

  function isEmptyValue(question, value) {
    if (value === undefined || value === null) return true;
    if (question.type === 'single' || question.type === 'text') return value === '';
    if (question.type === 'multi') return Array.isArray(value) && value.length === 0;
    if (question.type === 'matrix') return isPlainObject(value) && Object.keys(value).length === 0;
    return false;
  }

  /*
   * 回答の検証（Frontend / Public GAS 共通）。
   * answers: {questionId: single=string | multi=string[] | matrix={rowId: scaleId} | text=string}
   * otherTexts: {questionId: string}（「その他」選択時のみ）
   * 未知のkey・非表示設問の回答・不正な型/選択肢は無視せずエラーにする。
   * 戻り値 clean は正規化（text trim）済みの回答。
   */
  function validateAnswers(schema, answers, otherTexts) {
    var idx = buildIndex(schema);
    var errors = [];
    var clean = { answers: {}, other_texts: {} };
    function fail(field, code) { errors.push({ field: field, code: code }); }

    if (!isPlainObject(answers)) { fail('answers', 'invalid_type'); return { ok: false, errors: errors, clean: clean }; }
    var others = otherTexts === undefined ? {} : otherTexts;
    if (!isPlainObject(others)) { fail('other_texts', 'invalid_type'); return { ok: false, errors: errors, clean: clean }; }

    Object.keys(answers).forEach(function (key) { if (!hasOwn(idx.byId, key)) fail(key, 'unknown_field'); });
    Object.keys(others).forEach(function (key) {
      var q = hasOwn(idx.byId, key) ? idx.byId[key] : null;
      var hasOther = q && getOptions(schema, q).some(function (o) { return o.other; });
      if (!hasOther) fail(key, 'unknown_field');
    });

    idx.order.forEach(function (id) {
      var question = idx.byId[id];
      var value = hasOwn(answers, id) ? answers[id] : undefined;
      var otherValue = hasOwn(others, id) ? others[id] : undefined;
      var visible = isVisible(schema, id, answers);

      if (!visible) {
        if (!isEmptyValue(question, value) || otherValue !== undefined) fail(id, 'hidden_field');
        return;
      }

      var options = getOptions(schema, question);
      var optionIds = options.map(function (o) { return o.id; });
      var selected = [];

      if (question.type === 'single') {
        if (isEmptyValue(question, value)) {
          if (question.required) fail(id, 'required');
        } else if (typeof value !== 'string') {
          fail(id, 'invalid_type');
        } else if (optionIds.indexOf(value) === -1) {
          fail(id, 'invalid_option');
        } else {
          selected = [value];
          clean.answers[id] = value;
        }
      } else if (question.type === 'multi') {
        if (isEmptyValue(question, value)) {
          if (question.required) fail(id, 'required');
        } else if (!Array.isArray(value)) {
          fail(id, 'invalid_type');
        } else {
          var seen = {};
          var bad = null;
          value.forEach(function (item) {
            if (typeof item !== 'string') bad = bad || 'invalid_type';
            else if (optionIds.indexOf(item) === -1) bad = bad || 'invalid_option';
            else if (seen[item]) bad = bad || 'duplicate_option';
            seen[item] = true;
          });
          if (bad) {
            fail(id, bad);
          } else {
            var exclusive = options.filter(function (o) { return o.exclusive && seen[o.id]; });
            if (exclusive.length && value.length > 1) {
              fail(id, 'exclusive_conflict');
            } else {
              selected = value.slice();
              clean.answers[id] = value.slice();
            }
          }
        }
      } else if (question.type === 'matrix') {
        var rowIds = question.rows.map(function (r) { return r.id; });
        var scaleIds = question.scale.map(function (s) { return s.id; });
        if (isEmptyValue(question, value)) {
          if (question.required) fail(id, 'required');
        } else if (!isPlainObject(value)) {
          fail(id, 'invalid_type');
        } else {
          var matrixClean = {};
          var matrixOk = true;
          Object.keys(value).forEach(function (rowKey) {
            if (rowIds.indexOf(rowKey) === -1) { fail(id + '.' + rowKey, 'unknown_field'); matrixOk = false; }
            else if (typeof value[rowKey] !== 'string' || scaleIds.indexOf(value[rowKey]) === -1) {
              fail(id + '.' + rowKey, 'invalid_option'); matrixOk = false;
            } else matrixClean[rowKey] = value[rowKey];
          });
          rowIds.forEach(function (rowId) {
            if (question.required && !hasOwn(value, rowId)) { fail(id + '.' + rowId, 'required'); matrixOk = false; }
          });
          if (matrixOk) clean.answers[id] = matrixClean;
        }
      } else if (question.type === 'text') {
        if (isEmptyValue(question, value)) {
          if (question.required) fail(id, 'required');
        } else if (typeof value !== 'string') {
          fail(id, 'invalid_type');
        } else if (CONTROL_CHARS.test(value)) {
          fail(id, 'invalid_text');
        } else {
          var text = normalizeText(value);
          if (charLength(text) > question.maxLength) fail(id, 'too_long');
          else if (text) clean.answers[id] = text;
          else if (question.required) fail(id, 'required');
        }
      }

      var otherSelected = selected.some(function (sel) {
        return options.some(function (o) { return o.id === sel && o.other; });
      });
      if (otherSelected) {
        if (typeof otherValue !== 'string') {
          fail(id, 'other_text_required');
        } else if (CONTROL_CHARS.test(otherValue)) {
          fail(id, 'invalid_text');
        } else {
          var otherText = normalizeText(otherValue);
          if (!otherText) fail(id, 'other_text_required');
          else if (charLength(otherText) > schema.limits.otherMaxLength) fail(id, 'too_long');
          else clean.other_texts[id] = otherText;
        }
      } else if (otherValue !== undefined) {
        fail(id, 'other_text_unexpected');
      }
    });

    return { ok: errors.length === 0, errors: errors, clean: clean };
  }

  /* ── Spreadsheet列定義（保存形式） ── */

  /* 設問ごとの保存列。matrixは行ごとに1列（<設問ID>__<行ID>）。 */
  function questionColumns(schema) {
    var cols = [];
    schema.questions.forEach(function (q) {
      if (q.type === 'matrix') {
        q.rows.forEach(function (r) { cols.push({ key: q.id + '__' + r.id, questionId: q.id, rowId: r.id, type: 'single' }); });
      } else {
        cols.push({ key: q.id, questionId: q.id, type: q.type });
      }
    });
    return cols;
  }

  /* 保存済みの行オブジェクト（列名→セル文字列）を内部表現（配列・object）へ戻す。 */
  function decodeRecord(schema, row) {
    var record = {};
    schema.questions.forEach(function (q) {
      var cell = function (key) { return row[key] === undefined || row[key] === null ? '' : String(row[key]); };
      if (q.type === 'single') { var s = cell(q.id); if (s) record[q.id] = s; }
      else if (q.type === 'multi') { var m = decodeMulti(cell(q.id)); if (m.length) record[q.id] = m; }
      else if (q.type === 'text') { var t = cell(q.id); if (t) record[q.id] = t; }
      else if (q.type === 'matrix') {
        var obj = {};
        q.rows.forEach(function (r) { var v = cell(q.id + '__' + r.id); if (v) obj[r.id] = v; });
        if (Object.keys(obj).length) record[q.id] = obj;
      }
    });
    return record;
  }

  /* ── 集計・ファネル（schema定義のみを使用） ── */

  /* 軸（{question, row?}）が取りうる値ID。 */
  function axisValues(schema, axis, record) {
    var q = getQuestion(schema, axis.question);
    if (!q) return [];
    var value = record[axis.question];
    if (q.type === 'matrix') {
      return axis.row && isPlainObject(value) && value[axis.row] ? [value[axis.row]] : [];
    }
    return selectedIds(q, value);
  }

  function axisOptions(schema, axis) {
    var q = getQuestion(schema, axis.question);
    if (!q) return [];
    return q.type === 'matrix' ? q.scale : getOptions(schema, q);
  }

  /* 単純集計。count=その選択肢を選んだ回答者数（延べ選択数ではない）、base=当該設問に回答した人数。 */
  function tally(schema, axis, records) {
    var options = axisOptions(schema, axis);
    var counts = {};
    options.forEach(function (o) { counts[o.id] = 0; });
    var base = 0;
    records.forEach(function (record) {
      var values = axisValues(schema, axis, record);
      if (!values.length) return;
      base++;
      values.forEach(function (v) { if (hasOwn(counts, v)) counts[v]++; });
    });
    return { base: base, counts: counts };
  }

  /*
   * クロス集計。cells[行ID][列ID] = 行・列の両方を選んだ回答者数（人数）。
   * 複数選択同士では1人が複数セルに入るため、行・列の合計は回答者数と一致しない。
   * rowBase[行ID] = その行の値を選んだ回答者数（割合の分母）。
   */
  function crosstab(schema, rowAxis, colAxis, records) {
    var rowOptions = axisOptions(schema, rowAxis);
    var colOptions = axisOptions(schema, colAxis);
    var cells = {};
    var rowBase = {};
    rowOptions.forEach(function (r) {
      rowBase[r.id] = 0;
      cells[r.id] = {};
      colOptions.forEach(function (c) { cells[r.id][c.id] = 0; });
    });
    records.forEach(function (record) {
      var rv = axisValues(schema, rowAxis, record);
      var cv = axisValues(schema, colAxis, record);
      rv.forEach(function (r) {
        if (!hasOwn(rowBase, r)) return;
        rowBase[r]++;
        cv.forEach(function (c) { if (hasOwn(cells[r], c)) cells[r][c]++; });
      });
    });
    return { rowBase: rowBase, cells: cells };
  }

  /* ファネル述語。predicate名（schema.funnels）またはインライン定義。 */
  function evalPredicate(schema, predicate, record) {
    var def = typeof predicate === 'string' ? (hasOwn(schema.funnels, predicate) ? schema.funnels[predicate] : null) : predicate;
    if (!def) return false;
    if (def.all) {
      return def.all.every(function (inner) { return evalPredicate(schema, inner, record); });
    }
    var values = axisValues(schema, { question: def.question, row: def.row }, record);
    if (def.nonEmpty) return values.length > 0;
    var list = def.include || def.anyOf || [];
    return values.some(function (v) { return list.indexOf(v) !== -1; });
  }

  /* 累積ファネル：各段階は前段階をすべて満たした回答者のみ数える。先頭は全回答者。 */
  function funnelFlow(schema, flowId, records) {
    var flow = schema.funnelFlows[flowId];
    var stages = [{ id: 'all', label: '回答者', count: records.length }];
    var current = records;
    flow.stages.forEach(function (name) {
      current = current.filter(function (record) { return evalPredicate(schema, name, record); });
      stages.push({ id: name, label: schema.funnels[name].label, count: current.length });
    });
    return stages;
  }

  return {
    getOptions: getOptions,
    getQuestion: getQuestion,
    charLength: charLength,
    normalizeText: normalizeText,
    encodeMulti: encodeMulti,
    decodeMulti: decodeMulti,
    selectedIds: selectedIds,
    isVisible: isVisible,
    isSectionVisible: isSectionVisible,
    validateAnswers: validateAnswers,
    questionColumns: questionColumns,
    decodeRecord: decodeRecord,
    axisValues: axisValues,
    axisOptions: axisOptions,
    tally: tally,
    crosstab: crosstab,
    evalPredicate: evalPredicate,
    funnelFlow: funnelFlow
  };
})();
