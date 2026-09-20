# GateGraph CI 로컬 확장 설계

- 상태: 로컬 우선 방향 선택 완료, 상세 설계 검토용
- 기준 코드: 276134c35fcbad0b3f03e39b60acc471fa23ea3a
- 목표: 보호되는 경로까지 설명하고 저장한 두 관측을 비교하며 검토용 제안을 제공한다.
- 기존 선언 정책 기능은 재구현하지 않는다. GitHub 자동 변경·App·호스팅·결제는 제외한다.

## 1. 구성과 호환성

Node.js 24와 현재 yaml 의존성을 유지한다. 기존 audit/demo 상태·종료
코드와 보수적 판정은 그대로 둔다. 설명 snapshot은 명시적 --explain
옵션으로 추가하고, compare는 로컬 보고서 두 개만 읽는 별도 명령이다.
새 기능에 GitHub 쓰기 endpoint나 자동 수정 경로를 넣지 않는다.

## 2. 기능과 수용 조건

| ID | 기능 | 완료로 인정할 행동 |
|---|---|---|
| GG-L01 | 전체 coverage 설명 | 직접 required인 작업, 검토 근거가 있는 aggregate에 연결된 작업, uncovered 작업, advisory/의도 불명 작업을 구분해 보여준다. |
| GG-L02 | 시점별 drift 비교 | 같은 저장소·대상 ref·분석 범위의 유효한 snapshot 둘을 비교해 producer/gate/정책/coverage 변화를 구분한다. |
| GG-L03 | 검토용 수정 제안 | 확인된 finding에 정확한 context/producer와 검토 조건을 제안한다. 사람이 검토했다거나 자동으로 고쳤다고 표시하지 않는다. |
| GG-L04 | 다중 정적 matrix | scalar 값의 최대 4개 axis, 전체 cell 최대 128개의 정적 곱을 지원한다. 관측 check 이름이 유일하게 대응할 때만 판정한다. |
| GG-L05 | 비교·권한 실패 설명 | 불완전 보고서, 구형 snapshot, 범위·분석 계약 불일치, 보호설정 404/권한 문제를 명시한다. finding 소실을 자동으로 해결이라 하지 않는다. |

## 3. Coverage snapshot

gategraph-coverage/1에는 저장소·commit·target ref·선택 workflow 범위,
producer 식별, gate 식별과 출처, voting policy fingerprint, bounded DAG
edge와 coverage 연결을 둔다. 체크 이름만으로 서로 다른 workflow나
provider를 합치지 않는다. matrix cell은 workflow/job/axis-value 식별로
구분한다.

가능한 모든 경로 조합을 열거하지 않고 edge와 gate 연결을 사용한다.
최대 producer 4096개, edge 16384개, 직렬화 snapshot 1 MiB로 제한한다.
요청한 설명을 완성하지 못하면 collection-error로 표시하고, 부분
snapshot을 complete로 내보내지 않는다. 기존 resource ceiling도 유지한다.

direct coverage와 transitive coverage의 근거를 구분한다. aggregate는
명시적 실패 전파 근거가 있어야 하며 단순히 needs에 등장한다는 이유만으로
보호됐다고 판단하지 않는다. 설명 옵션이 기존 finding 판정을 바꾸지 않는다.

## 4. Drift 비교

양쪽 snapshot schema와 분석 계약, repository/ref, workflow 선택 범위가
맞고 collection이 complete일 때 비교한다. source SHA 차이는 관측 좌표로
보존하며, timestamps와 run 배열 순서만 달라진 경우에는 정책 변화로
세지 않는다. 실제 policy나 workflow 내용 fingerprint의 변화와 단순
재관측을 구분한다.

결과는 comparable, changes, before/after provenance, unresolved를 가진다.
새 producer, gate 추가/제거, voting 정책 변화, coverage 상태 변화를
표시한다. legacy report에 snapshot이 없거나 한쪽이 collection-error이면
comparison-unavailable로 종료한다. 빈 results의 차이만으로 해결 판정을
만들지 않는다. 현재 수집한 ruleset을 과거 commit 시점의 설정으로
소급하지 않으며 두 관측 시점 사이의 변화만 설명한다.

비교 입력은 명시한 로컬 JSON 두 개이며 각각 8 MiB로 제한한다. 중복 키,
잘못된 타입·schema·digest, 지나친 깊이/항목 수를 거절한다. 원본은
바꾸지 않고 JSON을 stdout으로 출력한다. 파일 저장은 호출자가 한다.

유효한 schema와 digest는 파일 일관성만 확인한다. 가져온 보고서가 실제
GitHub 관측에서 만들어졌거나 작성자가 인증됐다는 보증으로 표시하지 않는다.

## 5. 검토 제안과 matrix

제안에는 requires_review=true와 finding의 정확한 증거 좌표가 있다.
직접 required context 추가 검토 또는 동일 workflow aggregate의 dependency와
실제 실패 전파를 함께 검토하도록 설명한다. 알려진 voting job을 advisory로
돌리는 방법은 기본 해결책으로 제안하지 않는다. YAML patch를 자동 생성·적용하지
않고 검토 후 재감사해야 한다는 조건을 붙인다.

다중 matrix에는 literal scalar axis만 허용한다. 동적 expression,
include/exclude, reusable workflow 전개와 실행 조건 시뮬레이션은 지원한
것으로 처리하지 않는다. 새 다중 axis의 check 이름은 모든 axis가 명시된
정적 name template과 관측 증거로 유일하게 대응해야 한다. 중복 이름,
예산 초과, 지원 밖 형태는 실패를 보존한다. 기존 단일 axis 계약을 유지한다.

## 6. 검증 기준

GG-L01은 direct·검토된 aggregate·uncovered·advisory·matrix 부분 coverage·
동명 workflow/provider 충돌·aggregate 근거 누락을 포함한다.
GG-L02는 timestamp/run 순서 차이, gate 제거, producer 추가, 정책 변화,
서로 다른 ref/scope/version, collection-error 반대편을 검증한다.
GG-L03은 제안의 좌표·조건·검토 필요 표기와 HTTP 쓰기 0회를 확인한다.
GG-L04는 2/3/4 axis, 128-cell 경계, 초과·중복·이름 충돌을 검증한다.
입력 자원 상한과 기존 판정 불변도 검사한다.

현재 전체 Node 테스트, 정확한 package allowlist, 설치된 package의
오프라인 실행, dependency audit를 다시 돌린다. 새 runtime 파일은 정확한
배포 목록에 추가하고 새 source에 맞춰 검사한다. 원래 공개 릴리스의
파일·태그·체크섬은 바꾸지 않는다. 각 GG-L 요구를 테스트와 결과에 연결한다.

## 7. 외부 연동 전환 조건

비공개 저장소를 배제하는 코드 조건은 현재도 없지만 실제 접근성은 권한에
따른다. 지정된 repository/SHA/run/ref와 보호설정 읽기 권한이 확보되면
GET-only 통합 검증을 수행할 수 있다. fixture 성공을 실제 비공개 운영
성공으로 표시하지 않는다. reusable workflow나 동적 matrix의 실증거를
추가로 연결해야 하는 경우에는 정확한 입력과 권한을 조사해 2단계의
별도 설계로 연결한다. 자동 수정·서비스 호스팅으로 범위를 바꾸지는 않는다.
