-- Calibrated against linkTokens/Lezer; no persistent fixtures or auth writes.
begin;
do $test$
declare item record; binding jsonb; actual boolean; checked integer := 0;
begin
  assert strpos(E'- 学习记录\n\n    - [[同名]]', '[[') = 15;
  assert public.reader_link_text_allowed(E'- 学习记录\n\n    - [[同名]]', 15), 'root exact nested-list regression';
  for item in select * from jsonb_to_recordset($cases$[
  {
    "name": "root-exact",
    "markdown": "- 学习记录\n\n    - [[同名]]",
    "expected": true,
    "at": 15
  },
  {
    "name": "unordered-parent",
    "markdown": "- 父项\n\n    - [[同名]]",
    "expected": true,
    "at": 13
  },
  {
    "name": "ordered-parent",
    "markdown": "1. 父项\n\n    1. [[同名]]",
    "expected": true,
    "at": 15
  },
  {
    "name": "two-space-child",
    "markdown": "- 父项\n\n  - [[同名]]",
    "expected": true,
    "at": 11
  },
  {
    "name": "plus-markers",
    "markdown": "+ 父项\n\n    + [[同名]]",
    "expected": true,
    "at": 13
  },
  {
    "name": "star-markers",
    "markdown": "* 父项\n\n    * [[同名]]",
    "expected": true,
    "at": 13
  },
  {
    "name": "ordered-to-unordered",
    "markdown": "1. 父项\n\n    - [[同名]]",
    "expected": true,
    "at": 14
  },
  {
    "name": "unordered-to-ordered",
    "markdown": "- 父项\n\n    1) [[同名]]",
    "expected": true,
    "at": 14
  },
  {
    "name": "wide-ordered-parent",
    "markdown": "10. 父项\n\n    - [[同名]]",
    "expected": true,
    "at": 15
  },
  {
    "name": "three-level-list",
    "markdown": "- 父项\n\n    - 二级\n\n        - [[同名]]",
    "expected": true,
    "at": 27
  },
  {
    "name": "list-paragraph",
    "markdown": "- 父项\n\n    [[同名]]",
    "expected": true,
    "at": 11
  },
  {
    "name": "nested-paragraph",
    "markdown": "- 父项\n\n    - 二级\n\n        [[同名]]",
    "expected": true,
    "at": 25
  },
  {
    "name": "nested-content-column",
    "markdown": "- 父项\n\n    - 二级\n\n      [[同名]]",
    "expected": true,
    "at": 23
  },
  {
    "name": "nested-sibling",
    "markdown": "- 父项\n\n    - 二级\n\n    - [[同名]]",
    "expected": true,
    "at": 23
  },
  {
    "name": "root-sibling",
    "markdown": "- 父项\n\n- [[同名]]",
    "expected": true,
    "at": 9
  },
  {
    "name": "after-list-paragraph",
    "markdown": "- 父项\n\n正文 [[同名]]",
    "expected": true,
    "at": 10
  },
  {
    "name": "indented-root-list",
    "markdown": "  - 父项\n\n      - [[同名]]",
    "expected": true,
    "at": 17
  },
  {
    "name": "lazy-list-paragraph",
    "markdown": "- 父项\n延续\n\n    - [[同名]]",
    "expected": true,
    "at": 16
  },
  {
    "name": "after-closed-list-fence",
    "markdown": "- 父项\n\n  ```\n  code\n  ```\n\n    - [[同名]]",
    "expected": true,
    "at": 33
  },
  {
    "name": "root-four-space-bullet-code",
    "markdown": "    - [[同名]]",
    "expected": false,
    "at": 7
  },
  {
    "name": "root-four-space-ordered-code",
    "markdown": "    1. [[同名]]",
    "expected": false,
    "at": 8
  },
  {
    "name": "root-indented-code",
    "markdown": "    [[同名]]",
    "expected": false,
    "at": 5
  },
  {
    "name": "root-code-continuation",
    "markdown": "    code\n    [[同名]]",
    "expected": false,
    "at": 14
  },
  {
    "name": "eight-space-list-code",
    "markdown": "- 父项\n\n        [[同名]]",
    "expected": false,
    "at": 15
  },
  {
    "name": "six-space-list-code",
    "markdown": "- 父项\n\n      [[同名]]",
    "expected": false,
    "at": 13
  },
  {
    "name": "ordered-list-code",
    "markdown": "1. 父项\n\n       [[同名]]",
    "expected": false,
    "at": 15
  },
  {
    "name": "nested-list-code",
    "markdown": "- 父项\n\n    - 二级\n\n          [[同名]]",
    "expected": false,
    "at": 27
  },
  {
    "name": "list-backtick-fence",
    "markdown": "- 父项\n\n    ```\n    [[同名]]\n    ```",
    "expected": false,
    "at": 19
  },
  {
    "name": "list-tilde-fence",
    "markdown": "- 父项\n\n    ~~~\n    [[同名]]\n    ~~~",
    "expected": false,
    "at": 19
  },
  {
    "name": "list-inline-code",
    "markdown": "- 父项\n\n    - `[[同名]]`",
    "expected": false,
    "at": 14
  },
  {
    "name": "list-escape",
    "markdown": "- 父项\n\n    - \\[[同名]]",
    "expected": false,
    "at": 14
  },
  {
    "name": "nested-list-fence",
    "markdown": "- 父项\n\n    - 二级\n\n      ```\n      [[同名]]\n      ```",
    "expected": false,
    "at": 33
  },
  {
    "name": "code-with-bullet-marker",
    "markdown": "- 父项\n\n        - [[同名]]",
    "expected": false,
    "at": 17
  },
  {
    "name": "nested-code-with-marker",
    "markdown": "- 父项\n\n    - 二级\n\n            - [[同名]]",
    "expected": false,
    "at": 31
  },
  {
    "name": "after-list-ended",
    "markdown": "- 父项\n\n正文\n\n    - [[同名]]",
    "expected": false,
    "at": 17
  },
  {
    "name": "after-heading-ended-list",
    "markdown": "- 父项\n# 标题\n\n    - [[同名]]",
    "expected": false,
    "at": 18
  },
  {
    "name": "item-start-indented-code",
    "markdown": "-     [[同名]]",
    "expected": false,
    "at": 7
  },
  {
    "name": "nested-item-start-code",
    "markdown": "- 父项\n  -     [[同名]]",
    "expected": false,
    "at": 14
  },
  {
    "name": "thematic-break-not-list",
    "markdown": "- - -\n\n    - [[同名]]",
    "expected": false,
    "at": 14
  },
  {
    "name": "list-code-continuation",
    "markdown": "- 父项\n\n      code\n      [[同名]]",
    "expected": false,
    "at": 24
  }
]$cases$::jsonb)
    as cases(name text, markdown text, expected boolean, at integer) loop
    binding := jsonb_build_object('id','list-instance','from',item.at - 1,'to',item.at + 5,'label','同名',
      'target',jsonb_build_object('bookId','qa-05-list','source','personal','id','missing-is-allowed'));
    actual := public.reader_valid_bindings(item.markdown,jsonb_build_array(binding),'qa-05-list');
    assert actual = item.expected, format('list context mismatch: %s; expected=%s actual=%s',item.name,item.expected,actual);
    checked := checked + 1;
  end loop;
  assert checked = 40;
end;
$test$;
rollback;
select '40 list-context cases passed (19 valid references, 21 code/escape exclusions), including exact at=15 regression; transaction rolled back' as result;
