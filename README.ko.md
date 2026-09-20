# GateGraph CI

[English](https://github.com/nowwcastle-sudo/gategraph-ci/blob/main/README.md) | [한국어](https://github.com/nowwcastle-sudo/gategraph-ci/blob/main/README.ko.md)

GateGraph CI는 GitHub의 병합 조건을 읽고 점검하는 실험적 진단 CLI(명령줄 도구)입니다. 병합 정책을 강제하거나 저장소가 안전하다고 증명하지 않습니다. 유지관리자의 실제 도입과 운영 환경 적합성은 확인되지 않았습니다.

병합을 막아야 할 작업이 실패해도 GitHub의 필수 검사가 모두 통과할 수 있는지 살펴볼 때 사용합니다. *필수 컨텍스트(required context)*는 브랜치 규칙에서 요구하는 정확한 검사 이름이고, *voting 작업*은 실패하면 병합을 막도록 의도한 작업입니다. GateGraph는 워크플로 작업, 실제 검사 실행, 현재 브랜치 규칙, 명시적 정책을 대조해 둘 사이의 누락을 찾습니다.

라이선스는 Apache License 2.0입니다. [LICENSE](LICENSE)를 참고하세요.
소스는 [nowwcastle-sudo/gategraph-ci](https://github.com/nowwcastle-sudo/gategraph-ci)의 `main` 브랜치입니다.
릴리스는 `v0.2.0-experimental.1`, 패키지는 `gategraph-ci@0.2.0-experimental.1`입니다.
실수로 npm에 게시하지 않도록 패키지의 `private: true`를 유지합니다. 공개 소스와 GitHub 릴리스 다운로드는 npm 게시 없이 사용할 수 있습니다.

저장소 문서는 릴리스 압축 파일보다 최신일 수 있습니다. 기존 `v0.2.0-experimental.1` 배포 파일에는 한국어판이 없으며 저장소에서 읽을 수 있습니다. 현재 소스로 새로 빌드하면 npm이 `README.ko.md`를 자동 포함하므로 파일이 9개가 됩니다. 이번 문서 수정은 릴리스 파일이나 체크섬을 바꾸지 않습니다.

## 명령별 기능

| 명령 또는 입력 | 동작과 적용 범위 |
|---|---|
| `demo` | 실제 분석 코어로 가상 증거를 분석합니다. 기본 결과는 `finding`이며 설치 후에는 계정이나 네트워크가 필요 없습니다. |
| `demo --scenario NAME` | `finding`, `policy-review`, `unknown`, `collection-error` 중 하나를 골라 보고서 상태를 확인합니다. |
| `audit --repo OWNER/NAME --sha SHA` | 전체 40자리 커밋 SHA를 기준으로 워크플로, 관측된 Actions 실행·작업·검사, 현재 규칙 집합, 기존 브랜치 보호를 수집해 JSON 보고서 하나를 출력합니다. |
| `--run-id ID` | 양의 정수 실행 ID를 선택합니다. 여러 워크플로라면 반복할 수 있지만 ID는 중복될 수 없고 선택한 워크플로마다 완료된 실행 하나만 허용합니다. |
| `--target-ref refs/heads/BRANCH` | 실행 증거에서 이미 확인된 대상 브랜치를 검증합니다. 빠진 대상 정보를 만들어 넣을 수 없습니다. |
| 워크플로 선택 | `--run-id`를 사용합니다. 워크플로 경로를 직접 지정하는 CLI 옵션은 없습니다. 제외한 실행과 워크플로 경로는 `provenance.scope`에 남으며 활성 필수 컨텍스트는 계속 적용됩니다. |
| `--policy-file FILE` | 최대 64 KiB의 로컬 strict JSON 정책을 읽습니다. `--target-ref`와 하나 이상의 `--run-id`가 필요하며 정확한 관측 실행 차수에 정책을 연결합니다. |
| `--help`, `demo --help`, `audit --help` | 증거를 수집하지 않고 사용법을 출력합니다. |
| `--version` | 설치된 패키지 이름과 버전을 출력합니다. |

audit 옵션의 순서는 바꿀 수 있습니다. 반복 가능한 옵션은 `--run-id`뿐입니다. 알 수 없는 옵션, 단일 옵션의 중복, 잘못된 값은 종료 코드 `1`을 반환합니다.

워크플로 파싱과 이름 확장에는 [로컬 자원 상한](https://github.com/nowwcastle-sudo/gategraph-ci/blob/main/docs/runtime-resource-limits.md)이 있습니다. 초과하면 수집 오류 `WORKFLOW_RESOURCE_LIMIT_EXCEEDED`를 반환합니다. 이는 분석기의 상한이며 GitHub Actions의 유효성 규칙이나 전체 프로세스의 메모리·시간 보장값이 아닙니다.

## 로그인 없이 실험 릴리스 다운로드

Node.js 24와 npm이 필요합니다. PowerShell의 같은 창에서 한 줄씩 실행하세요.
공개 파일 다운로드에는 GitHub 로그인이 필요 없습니다. 다운로드 실패나 체크섬 불일치가 생기면 중단하고 해당 폴더를 보존하세요. 이전 파일을 덮어쓰지 마세요.

```powershell
$ErrorActionPreference = 'Stop'
$gategraphAssets = Join-Path ([IO.Path]::GetTempPath()) ('gategraph-release-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $gategraphAssets -ErrorAction Stop | Out-Null
$gategraphRelease = 'https://github.com/nowwcastle-sudo/gategraph-ci/releases/download/v0.2.0-experimental.1'
$gategraphTarball = Join-Path $gategraphAssets 'gategraph-ci-0.2.0-experimental.1.tgz'
Invoke-WebRequest -Uri ($gategraphRelease + '/gategraph-ci-0.2.0-experimental.1.tgz') -OutFile $gategraphTarball
Invoke-WebRequest -Uri ($gategraphRelease + '/gategraph-ci-0.2.0-experimental.1.tgz.sha256') -OutFile ($gategraphTarball + '.sha256')
$gategraphHash = ((Get-Content -LiteralPath ($gategraphTarball + '.sha256') -Raw).Trim() -split '\s+')[0]
if ($gategraphHash -notmatch '^[a-fA-F0-9]{64}$') { throw 'Invalid checksum file; stop.' }
if ((Get-FileHash -LiteralPath $gategraphTarball -Algorithm SHA256).Hash -ine $gategraphHash) { throw 'Checksum mismatch; stop and retain downloads.' }
```

체크섬은 내려받은 파일이 릴리스의 체크섬과 일치하는지 확인합니다. 게시자의 신원을 독립적으로 인증하지는 않습니다. 404는 지정한 공개 파일을 사용할 수 없다는 뜻입니다. TLS·프록시·시간 초과 오류만으로는 릴리스가 없다고 단정할 수 없습니다.

## 고정 버전 의존성 캐시 준비

TGZ는 단독으로 설치할 수 있는 오프라인 묶음이 아닙니다. `yaml@2.9.0`이 필요합니다.
인터넷에 연결된 상태에서 레지스트리 메타데이터와 의존성 파일을 준비한 뒤, 같은 캐시를 지정해 오프라인으로 설치합니다.

```powershell
$gategraphCache = Join-Path $gategraphAssets 'npm-cache'
npm.cmd cache add yaml@2.9.0 --cache $gategraphCache --ignore-scripts --no-audit --no-fund
$gategraphCacheExit = $LASTEXITCODE
if ($gategraphCacheExit -ne 0) { throw 'Dependency preparation failed; retain output and stop.' }
```

새 캐시를 준비할 때는 레지스트리에 접근해야 합니다. 미리 준비한 캐시로 오프라인 설치가 가능할 수 있지만 메타데이터나 의존성 파일이 빠졌다면 설치를 중단해야 합니다. 임의로 `--offline`을 빼거나 의존성 버전을 바꾸지 마세요.

## 첫 작업: 설치한 가상 데모 실행

위의 다운로드 검증과 캐시 준비를 마친 뒤 이어서 진행합니다. 한 줄씩 실행하세요.

```powershell
$gategraphInstall = Join-Path ([IO.Path]::GetTempPath()) ('gategraph-install-' + [guid]::NewGuid().ToString('N'))
if (Test-Path -LiteralPath $gategraphInstall) { throw 'Choose a new temporary install directory.' }
npm.cmd install --prefix $gategraphInstall --cache $gategraphCache --offline --ignore-scripts --no-audit --no-fund --no-package-lock $gategraphTarball
$gategraphInstallExit = $LASTEXITCODE
if ($gategraphInstallExit -ne 0) { throw "GateGraph install did not complete successfully (exit $gategraphInstallExit). Keep this directory and npm logs; do not run the demo." }
```

Windows에서는 PowerShell이 `npm`을 `npm.ps1`로 해석하면 실행 정책에 막히므로 `npm.cmd`를 사용합니다. 시도마다 별도 임시 설치 폴더를 쓰므로 이전 설치와 섞이지 않습니다. 결과를 검토할 때까지 폴더와 로그를 보존하고 재시도에는 새 폴더를 사용하세요.

`npm.cmd` 바로 다음 줄에서 설치 프로세스의 종료 코드를 기록합니다. 설치가 끝나고 종료 코드 `0`이 확인된 경우에만 진행하세요. 시간 초과, 중단, 종료 코드 누락, 폴더에 파일만 남은 경우는 설치 상태가 **UNKNOWN**입니다. 폴더와 로그를 보존하고 데모를 실행하지 마세요.

### 전체 데모 보고서를 저장하고 다시 읽기

설치 종료 코드 `0`을 확인한 뒤에만 같은 PowerShell 창에서 한 줄씩 실행합니다. 기본 가상 데모의 JSON 표준 출력을 현재 폴더의 새 UTF-8 파일에 온전히 저장합니다.

```powershell
$gategraphOutput = Join-Path (Get-Location) ('gategraph-demo-' + [guid]::NewGuid().ToString('N') + '.json')
if (Test-Path -LiteralPath $gategraphOutput) { throw 'Choose a new demo output path.' }
& (Join-Path $gategraphInstall 'node_modules/.bin/gategraph.cmd') demo | Out-File -LiteralPath $gategraphOutput -Encoding utf8 -NoClobber -ErrorAction Stop
$gategraphDemoExit = $LASTEXITCODE
if ($gategraphDemoExit -ne 2) { throw "Unexpected demo exit: $gategraphDemoExit. Keep the output and stop." }
$gategraphReport = Get-Content -LiteralPath $gategraphOutput -Raw | ConvertFrom-Json
if ($gategraphReport.status -ne 'finding') { throw 'Expected status: finding.' }
if ($gategraphReport.subject.kind -ne 'fixture') { throw 'Expected subject.kind: fixture.' }
if ($gategraphReport.subject.repository -ne 'fixture/synthetic-demo') { throw 'Expected repository: fixture/synthetic-demo.' }
$gategraphOutput
```

데모는 가상 증거를 실제 분석 코어에 넣습니다. JSON 보고서 하나에 `status: finding`, `subject.kind: fixture`, 저장소 `fixture/synthetic-demo`가 표시되어야 합니다. 병합을 막지 못하는 voting 실패 경로 하나를 넣은 예제이므로 **종료 코드 2가 정상 기대값**입니다.

설치 후 데모 실행에는 인증정보, 네트워크, GitHub CLI, 소스 체크아웃, 테스트 보조 도구가 필요 없습니다. GateGraph 자체는 npm에 게시되어 있지 않습니다.

같은 PowerShell 변수를 사용해 다른 시나리오나 설치된 명령 정보를 확인할 수 있습니다.

```powershell
& (Join-Path $gategraphInstall 'node_modules/.bin/gategraph.cmd') demo --scenario policy-review
& (Join-Path $gategraphInstall 'node_modules/.bin/gategraph.cmd') demo --scenario unknown
& (Join-Path $gategraphInstall 'node_modules/.bin/gategraph.cmd') demo --scenario collection-error
& (Join-Path $gategraphInstall 'node_modules/.bin/gategraph.cmd') --help
& (Join-Path $gategraphInstall 'node_modules/.bin/gategraph.cmd') --version
```

## 상태와 종료 코드

| 상태 | 의미 | 종료 코드 |
|---|---|---:|
| `finding` | 제공한 정책과 관측 증거로 병합을 막지 못하는 voting 실패 경로가 입증되었습니다. | 2 |
| `policy-review` | 그래프에서 누락이 보이지만 voting 의도는 사람이 검토해야 합니다. | 3 |
| `unknown` | 명시적 advisory 정책을 포함해, 한정된 증거에서 finding을 단정하지 않습니다. | 0 |
| `collection-error` | 필요한 증거가 불완전하거나 형식이 잘못되었거나 지원 범위 밖이거나 모호합니다. | 4 |

`unknown`은 저장소가 안전하다는 증거가 아닙니다. audit와 demo는 표준 출력에 JSON 문서 하나를 씁니다. 도움말과 버전은 텍스트를 출력한 뒤 코드 0으로 종료하고, 잘못된 사용법과 예상하지 못한 내부 오류는 코드 1로 종료합니다.

종료 코드 `0`은 제공된 증거 안에서 누락 경로를 입증하지 못했거나 해당 작업이 명시적 advisory일 때도 나옵니다. 가능한 모든 실패의 차단 여부나 정책 작성자의 의도를 인증하지 않습니다. 최상위 상태와 함께 `results` 및 각 사유 코드를 읽으세요. 다른 사람이 범위를 확인할 수 있도록 보고서의 `subject`와 `provenance`를 보존하세요.

## 실제 저장소 감사와 명시적 범위 선택

실제 감사에는 인증된 GitHub CLI(`gh`)가 추가로 필요합니다. 대상 저장소의 Actions, 콘텐츠, 규칙 집합, 브랜치 보호 증거를 읽을 권한도 있어야 합니다. 아래 명령의 자리표시자는 실제로 관측한 실행 정보로 바꿔야 합니다.

GitHub CLI는 [공식 설치 안내](https://cli.github.com/manual/installation)를 따라 설치하고 [gh auth login](https://cli.github.com/manual/gh_auth_login)으로 인증하세요. 계정은 선택한 저장소와 검사 실행·브랜치 보호를 포함한 모든 필수 API를 읽을 수 있어야 합니다. 로그인 성공만으로 권한이 확인되지는 않으며 조직 제한과 토큰 종류에 따라 접근이 달라집니다. GateGraph는 권한을 요청하거나 높이지 않습니다. 저장소의 Actions 실행 상세에서 전체 SHA, 완료된 실행 ID, 대상 브랜치를 확인한 뒤 아래 자리표시자를 바꾸세요.

```text
gategraph audit --repo owner/name --sha 40-hex-commit
gategraph audit --repo owner/name --sha 40-hex-commit --run-id ID --target-ref refs/heads/BRANCH
gategraph audit --repo owner/name --sha 40-hex-commit --run-id ID --target-ref refs/heads/BRANCH --policy-file reviewed-policy.json
```

로컬 경로에 설치했다면 첫 작업에서 사용한 `gategraph.cmd` 전체 경로로 실행합니다. 옵션 순서는 바꿀 수 있습니다. 여러 워크플로는 `--run-id`를 반복하되 워크플로마다 완료된 관측 실행 하나만 선택하세요. 선택 옵션을 생략하면 관측된 실행 전체를 포함합니다. 최신 실행이나 성공한 실행을 자동으로 고르지 않습니다.

`--target-ref`는 선택한 실행 증거에 이미 있는 대상을 검증합니다. 빠진 PR 기준 브랜치를 채우거나 저장소의 기본 브랜치로 대신할 수 없습니다. 명시적으로 선택하면 제외한 실행 ID와 워크플로 경로를 `provenance.scope`에 기록하고 그 범위에서 수집의 완전성을 판단합니다. 워크플로를 제외해도 활성 필수 컨텍스트의 요구는 사라지지 않습니다.

## 검토한 작성 정책

실제 수집은 voting 정책이나 집계 작업의 실패 전파 방식을 추론하지 않습니다. 직접 필수 검사로 지정된 생산 작업에는 집계 정책이 필요 없습니다. `needs`가 있는 필수 작업을 통해 의존 작업까지 차단된다고 판단하려면 해당 워크플로·작업 식별자에 대한 정확한 `all-needs` 증거가 필요합니다. 의존 관계만으로 병합 차단을 입증할 수 없습니다.

`--policy-file`은 운영자가 작성한 주장을 전달하는 명시적 정책 계약입니다. `--target-ref`와 하나 이상의 `--run-id`가 모두 필요합니다. 유지관리자의 승인을 인증하거나 독립된 뒷받침 증거를 가져오지는 않습니다. 검토한 증거를 직접 보존하고 `needs` 목록만 보고 `all-needs`를 적지 마세요. gate 증거만으로 voting 의도를 알 수 없고 voting 증거만으로 집계 작업의 실패 전파를 입증할 수도 없습니다.

아래는 가상 좌표를 쓴 전체 스키마 예시입니다. 실제로 관측한 증거로 취급하지 마세요.

```json
{
  "contract": "gategraph-authored-policy/v1",
  "coordinate": {
    "repository": "example/project",
    "sha": "0123456789abcdef0123456789abcdef01234567",
    "targetRef": "refs/heads/main",
    "runs": [
      { "runId": "501", "workflowPath": ".github/workflows/ci.yml", "runAttempt": 2 }
    ]
  },
  "review": {
    "observedAt": "2026-09-05T06:00:00.000Z",
    "evidence": "operator-reviewed-gate-behavior-v1"
  },
  "jobs": [
    { "workflowPath": ".github/workflows/ci.yml", "jobId": "producer", "mergePolicy": "voting" },
    { "workflowPath": ".github/workflows/ci.yml", "jobId": "dependency", "mergePolicy": "voting" }
  ],
  "gates": {
    ".github/workflows/ci.yml/gate": {
      "failurePropagation": "all-needs",
      "evidence": "operator-reviewed-gate-failure-propagation-v1"
    }
  }
}
```

64 KiB 이내의 strict JSON을 사용합니다. 추가 키, 디코딩 후 어느 깊이에서든 중복되는 키, prototype 관련 키, 잘못된 값, 중복 실행·작업 식별자는 거부합니다. 저장소, SHA, 대상, 선택한 실행·워크플로 집합, 관측된 실행 차수가 모두 일치해야 합니다. 수집기는 그 차수의 작업을 읽으므로 재실행이 검토한 차수를 조용히 대체할 수 없습니다.

`observedAt`은 Unix epoch 이후이면서 이번 분석 시각보다 늦지 않은 표준 UTC 표기여야 합니다. 임의의 유효기간은 없습니다. 감사는 현재 활성화된 제어 설정을 새로 수집하며, 그 규칙이 과거 검토 시점에도 존재했다고 주장하지 않습니다. 정책을 적용해도 기존 실패를 모두 보존하며 불완전한 수집을 완전한 수집으로 바꾸지 않습니다.

모든 보고서는 분석기·버전·계약·분석 시각의 출처 정보를 기록합니다. 작성 정책을 사용하면 좌표·시간 정보와 SHA-256 앞 12자리 지문을 `provenance.policyInput`에, gate 증거 지문을 `provenance.gatePolicies`에 남깁니다. 원래 증거 식별자와 로컬 정책 파일 경로는 보고서에 복사하지 않습니다.

## 수집 오류에서 복구하기

결과에 `reasonCode`와 `recoveryAction`이 있으면 확인하세요.

- `TARGET_REF_UNRESOLVED`: 권위 있는 대상 정보를 담은 관측 실행을 선택하세요. 대상 옵션으로 빠진 inline PR base를 보완할 수 없습니다.
- `RUN_SELECTION_MISMATCH` 또는 `RUN_SELECTION_AMBIGUOUS`: 요청한 SHA의 실행 ID를 확인하고 워크플로마다 완료된 실행 하나를 선택하세요.
- `TARGET_REF_MISMATCH`: 관측 증거를 확인한 뒤 지정한 대상을 바로잡으세요.
- `POLICY_INPUT_INVALID`: JSON 문법, 정확한 스키마, 크기, 관측 시각을 확인하세요.
- `POLICY_COORDINATE_MISMATCH`: 정확한 저장소·SHA·대상·워크플로·실행·차수에 맞춰 정책을 검토하세요.

그 밖의 불완전하거나 지원하지 않는 증거도 수집 오류로 처리합니다. 기존 브랜치 보호 API의 404는 그 자체로 보호가 없다는 뜻이 아닙니다.

## 읽기 전용 범위

실제 수집은 허용 목록에 있는 `gh api --method GET` 요청만 사용합니다. GateGraph는 워크플로 텍스트를 실행하거나 워크플로를 가동하거나 GitHub 상태를 바꾸거나 자동 수정을 적용하지 않습니다.

| 단계 | 네트워크와 로컬 파일 범위 |
|---|---|
| 다운로드와 의존성 준비 | 공개 GitHub 릴리스 파일과 npm 레지스트리를 읽고 새 다운로드 폴더와 지정한 npm 캐시에 씁니다. |
| 오프라인 설치 | 검증한 TGZ와 준비한 캐시를 읽고 새 로컬 설치 폴더와 npm 로그를 씁니다. 설치 수명주기 스크립트는 비활성화합니다. |
| 설치된 데모 | 포함된 가상 데이터를 사용하고 JSON을 표준 출력에 씁니다. 예시의 PowerShell 리디렉션이 새 로컬 보고서 파일을 만듭니다. |
| 실제 감사 | 인증된 `gh`로 허용된 GET 요청을 보냅니다. 대상은 저장소 메타데이터, Git 트리, 워크플로 콘텐츠, Actions 실행·작업, 검사 실행, 규칙 집합, 브랜치 보호입니다. 요청한 경우에만 로컬 정책 파일을 읽고 보고서를 표준 출력에 씁니다. |

보고서에는 저장소 이름, SHA, 브랜치 이름, 실행·워크플로 식별자가 들어갈 수 있으므로 공유 전에 검토하세요. 인증은 GitHub CLI가 담당합니다. 정책 파일이나 이슈 보고서에 토큰을 넣지 마세요.

## 지원하는 워크플로와 자원 상한

GateGraph는 워크플로 텍스트를 데이터로 파싱합니다. 지원 범위는 정적 작업 이름(생략 시 작업 ID), 순환이 없는 명시적 `needs` 의존 관계, 작업 이름에 `matrix.KEY`로 참조한 문자열·숫자·불리언 값의 단일 matrix 축입니다. 작업 수준 조건이 있으면 정확히 `always()`여야 합니다.

재사용 워크플로 작업(`jobs.<id>.uses`), 작업 수준 `continue-on-error`, 다중 matrix 축, include/exclude matrix, 그 밖의 작업 이름 표현식과 작업 조건은 지원 범위 밖입니다. 지원하지 않거나 모호한 증거는 `collection-error`로 처리합니다. 임의의 Actions 표현식을 평가하거나 셸 단계를 실행해 동작을 알아내지 않습니다. 트리거 이름은 파싱하지만 이벤트·경로 조건 전체를 시뮬레이션하지는 않습니다.

| 로컬 분석기 자원 | 상한 |
|---|---:|
| 워크플로 하나 / 전체의 UTF-8 텍스트 | 1 MiB / 4 MiB |
| 워크플로당 작업 수 | 128 |
| 선언한 작업 이름 길이 | 1,024 |
| 지원하는 matrix 축의 값 개수 | 128 |
| 문자열로 바꾼 matrix 값 길이 | 256 |
| 확장된 검사 이름 하나의 길이 | 2,048 |
| 감사 전체의 확장된 검사 이름 길이 합 | 65,536 |

이름 길이는 JavaScript 문자열 길이로 계산합니다. 상한을 넘으면 부분 finding 없이 분석 전체를 `WORKFLOW_RESOURCE_LIMIT_EXCEEDED`로 중단합니다. 일치하는 관측 실행이 없는 워크플로에도 적용됩니다. 실행 선택으로 범위를 줄일 수는 있지만 활성 필수 컨텍스트를 없애거나 제외한 워크플로가 안전하다고 입증할 수는 없습니다. 전체 계약은 [자원 상한 문서](docs/runtime-resource-limits.md)를 참고하세요.

## 한계

- 실험적 OSS입니다. 진단은 병합 강제나 운영 인증을 대신하지 않습니다.
- 문서에 적힌 GitHub 증거 일부만 지원합니다. actionlint 대체재나 범용 GitHub Actions 표현식 평가기가 아닙니다.
- 불완전하거나 잘못되었거나 지원 범위 밖이거나 모호한 증거는 `collection-error`로 처리합니다.
- 작성 정책은 운영자의 주장입니다. 작성자를 인증하거나 주장한 동작을 독립적으로 입증하지 않습니다.
- 저장소를 지속 감시하거나 수정 작업을 실행하지 않습니다.

## 로컬 검증

Node 24가 필요합니다. 소스 체크아웃의 저장소 루트에서 PowerShell을 여세요. 같은 창에서 한 줄씩 실행하고 오류가 나면 중단합니다. 아래 npm 명령은 시작된 뒤 각각 종료 코드 0으로 끝나야 합니다.

1. 잠금 파일에 지정된 의존성을 설치합니다.

   ```powershell
   npm.cmd ci --ignore-scripts
   $LASTEXITCODE
   ```

2. 같은 npm 캐시에 고정 버전 의존성의 메타데이터와 파일을 명시적으로 준비합니다.

   ```powershell
   npm.cmd cache add yaml@2.9.0 --ignore-scripts --no-audit --no-fund
   $LASTEXITCODE
   ```

   이 단계에는 네트워크 연결이 필요합니다. `npm ci`는 잠금 파일의 tarball을 캐시하면서도 새 오프라인 tarball 설치에 필요한 레지스트리 메타데이터를 남기지 않을 수 있습니다. 세 단계 모두 같은 캐시 설정을 유지하세요.

3. 전체 테스트를 실행합니다.

   ```powershell
   npm.cmd test
   $LASTEXITCODE
   ```

설치 패키지 테스트는 `npm test`에서 npm CLI 경로를 받아 새 tarball을 만들고 `LICENSE`와 `README.ko.md`를 포함한 정확한 9개 파일 목록을 확인한 뒤 별도 임시 폴더에 오프라인으로 설치합니다. 이 테스트를 `node --test`로 직접 실행하는 방식은 지원하지 않으며 `npm test`를 사용하라는 안내가 나옵니다. 네트워크가 필요한 준비 단계가 앞서 설명한 설치 후 데모의 오프라인 실행 조건을 바꾸지는 않습니다.

테스트는 임시 파일을 보존하며 온라인 설치로 우회하지 않습니다. `npm run pack:check`는 dry-run 목록을 출력하고 설치 패키지 테스트가 실제 파일 구성과 실행 결과를 검증합니다. CI 증거는 정확히 해당 소스 커밋과 실행 환경에만 적용됩니다. 새 후보에는 별도 증거가 필요합니다.

## 소스 빌드와 기여

깨끗한 체크아웃, 정확한 9개 파일 압축본, 체크섬, 오프라인 설치, 가상 데모는 [소스 빌드 안내](https://github.com/nowwcastle-sudo/gategraph-ci/blob/main/docs/release/public-candidate.md)를 따르세요. 소스 압축본과 설치용 TGZ는 서로 다른 파일입니다.

[CONTRIBUTING](https://github.com/nowwcastle-sudo/gategraph-ci/blob/main/CONTRIBUTING.md), [SECURITY](https://github.com/nowwcastle-sudo/gategraph-ci/blob/main/SECURITY.md), [CODE_OF_CONDUCT](https://github.com/nowwcastle-sudo/gategraph-ci/blob/main/CODE_OF_CONDUCT.md)를 읽어주세요. 재현에는 가상 데이터를 사용하고 실제 저장소 증거는 민감한 내용을 가리세요.

공개되었다는 사실만으로 수요, 유료 도입, 운영 준비가 입증되지는 않습니다. 호스팅 운영, 자동 수정, GitHub 쓰기 기능에는 별도의 검토된 설계가 필요합니다.

업데이트할 때는 검증한 새 TGZ를 새 폴더에 설치하고 사용할 실행 파일을 명시적으로 고르세요. 되돌릴 때는 보존한 이전 설치 폴더를 사용하거나 이전의 검증된 TGZ를 또 다른 새 폴더에 설치하세요. 실패한 설치 폴더와 보고서는 검토할 때까지 보존하세요.
